import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { PlaybackUpdate } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import type { ApplySnapshotResult, WatchPageContext } from '../../messaging';
import { onMessage, sendMessage } from '../../messaging';
import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
  type NetflixRpcResponse,
} from './player-rpc';

const NETFLIX = STREAMING_SERVICE_DEFINITION_BY_ID.netflix;
const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'ended'] as const;
const SEEK_THRESHOLD_SEC = 5;
const SUPPRESSION_MS = 750;
const PLAYER_RESPONSE_TIMEOUT_MS = 1500;

function getMediaTitle(): string {
  return document.title.replace(/\s*-\s*Netflix$/i, '').trim() || 'Netflix';
}

function sendPlayerCommand(command: NetflixPlayerCommand): Promise<ApplySnapshotResult> {
  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      resolve({ applied: false, reason: 'Netflix player API is not ready yet.' });
    }, PLAYER_RESPONSE_TIMEOUT_MS);

    function handleResponse(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as Partial<NetflixRpcResponse> | null;
      if (data?.source !== NETFLIX_PLAYER_RESPONSE_SOURCE || data.id !== id || !data.response) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);
      resolve(data.response);
    }

    window.addEventListener('message', handleResponse);
    window.postMessage(
      { source: NETFLIX_PLAYER_REQUEST_SOURCE, id, command } satisfies NetflixRpcRequest,
      '*',
    );
  });
}

export function runNetflixContentScript(ctx: ContentScriptContext): void {
  let activeVideo: HTMLVideoElement | null = null;
  let lastMediaId: string | null = null;
  let suppressUntil = 0;
  let pendingFrame: number | null = null;

  const readContext = (): WatchPageContext | null => {
    const mediaId = NETFLIX.extractMediaId(new URL(location.href));
    if (!activeVideo || mediaId === null) return null;
    return { streamingServiceId: 'netflix', mediaId, title: getMediaTitle() };
  };

  const readPlayback = (): PlaybackUpdate | null => {
    const context = readContext();
    if (!context || !activeVideo) return null;
    return {
      ...context,
      positionSec: Number(activeVideo.currentTime.toFixed(3)),
      playing: !activeVideo.paused,
    };
  };

  const sendContextIfChanged = () => {
    const context = readContext();
    if (!context || context.mediaId === lastMediaId) return;
    lastMediaId = context.mediaId;
    void sendMessage('content:context', context).catch(() => undefined);
  };

  const sendPlaybackUpdate = () => {
    if (performance.now() < suppressUntil) return;
    const update = readPlayback();
    if (update) void sendMessage('content:playback-update', update).catch(() => undefined);
  };

  const onVideoEvent = () => {
    refresh();
    sendPlaybackUpdate();
  };

  function refresh() {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video !== activeVideo) {
      if (activeVideo) {
        for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, onVideoEvent);
      }
      activeVideo = video;
      if (activeVideo) {
        for (const e of VIDEO_EVENTS) activeVideo.addEventListener(e, onVideoEvent);
      }
    }
    sendContextIfChanged();
  }

  const scheduleRefresh = () => {
    if (pendingFrame !== null) return;
    pendingFrame = ctx.requestAnimationFrame(() => {
      pendingFrame = null;
      refresh();
    });
  };

  const pageObserver = new MutationObserver(scheduleRefresh);
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  ctx.onInvalidated(() => pageObserver.disconnect());

  ctx.addEventListener(window, 'wxt:locationchange', scheduleRefresh);

  ctx.onInvalidated(onMessage('party:request-context', () => readContext()));
  ctx.onInvalidated(onMessage('party:request-playback', () => readPlayback()));

  ctx.onInvalidated(
    onMessage('party:apply-snapshot', async ({ data }) => {
      if (!activeVideo || !readContext()) {
        return { applied: false, reason: 'Netflix player is still loading.' };
      }

      suppressUntil = performance.now() + SUPPRESSION_MS;

      const { positionSec, playing } = data.playback;
      const command: NetflixPlayerCommand =
        Math.abs(activeVideo.currentTime - positionSec) > SEEK_THRESHOLD_SEC
          ? { playing, positionMs: Math.round(positionSec * 1000) }
          : { playing };

      const result = await sendPlayerCommand(command).catch(() => ({
        applied: false as const,
        reason: 'Sync failed on this tab.',
      }));

      if (result.applied) suppressUntil = performance.now() + SUPPRESSION_MS;
      return result;
    }),
  );

  refresh();
}
