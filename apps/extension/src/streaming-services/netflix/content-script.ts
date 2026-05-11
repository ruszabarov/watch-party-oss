import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { PlaybackUpdate } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { onMessage, sendMessage } from '../../messaging';
import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
} from './player-rpc';

const NETFLIX = STREAMING_SERVICE_DEFINITION_BY_ID.netflix;
const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'ended'] as const;
const SEEK_THRESHOLD_SEC = 5;
const SUPPRESSION_MS = 750;

function sendPlayerCommand(command: NetflixPlayerCommand): void {
  window.postMessage(
    { source: NETFLIX_PLAYER_REQUEST_SOURCE, command } satisfies NetflixRpcRequest,
    '*',
  );
}

export function runNetflixContentScript(ctx: ContentScriptContext): void {
  let activeVideo: HTMLVideoElement | null = null;
  let lastMediaId: string | null = null;
  let suppressUntil = 0;
  let pendingFrame: number | null = null;

  const readMediaId = (): string | null => {
    const mediaId = NETFLIX.extractMediaId(new URL(location.href));
    if (!activeVideo || mediaId === null) return null;

    return mediaId;
  };

  const readPlayback = (): PlaybackUpdate | null => {
    const mediaId = readMediaId();
    if (mediaId === null || !activeVideo) return null;

    return {
      mediaId,
      title: document.title,
      positionSec: activeVideo.currentTime,
      playing: !activeVideo.paused,
    };
  };

  const sendContextIfChanged = () => {
    const mediaId = readMediaId();
    if (mediaId === null || mediaId === lastMediaId) return;

    lastMediaId = mediaId;
    void sendMessage('content:context', mediaId).catch(() => undefined);
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

  ctx.onInvalidated(onMessage('party:request-playback', () => readPlayback()));

  ctx.onInvalidated(
    onMessage('party:apply-snapshot', ({ data }) => {
      if (!activeVideo || readMediaId() === null) return;

      suppressUntil = performance.now() + SUPPRESSION_MS;

      const { positionSec, playing } = data.playback;
      const command: NetflixPlayerCommand =
        Math.abs(activeVideo.currentTime - positionSec) > SEEK_THRESHOLD_SEC
          ? { playing, positionMs: Math.round(positionSec * 1000) }
          : { playing };

      sendPlayerCommand(command);
    }),
  );

  refresh();
}
