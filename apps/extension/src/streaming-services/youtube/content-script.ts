import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { PlaybackUpdate } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { onMessage, sendMessage } from '../../messaging';
import { isYoutubeAdPlayback } from './ads';

const YOUTUBE = STREAMING_SERVICE_DEFINITION_BY_ID.youtube;
const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'ended'] as const;
const SEEK_THRESHOLD_SEC = 1.5;
const SUPPRESSION_MS = 750;

function findPlayer(video: HTMLVideoElement | null): Element | null {
  return video?.closest('#movie_player') ?? document.querySelector('#movie_player');
}

function isAdShowing(player: Element | null): boolean {
  return isYoutubeAdPlayback(player?.getAttribute('class'));
}

export function runYoutubeContentScript(ctx: ContentScriptContext): void {
  let activeVideo: HTMLVideoElement | null = null;
  let activePlayer: Element | null = null;
  let lastMediaId: string | null = null;
  let wasAdShowing = false;
  let suppressUntil = 0;
  let pendingFrame: number | null = null;

  const readMediaId = (): string | null => {
    const mediaId = YOUTUBE.extractMediaId(new URL(location.href));
    if (!activeVideo || mediaId === null) return null;
    return mediaId;
  };

  const readPlayback = (): PlaybackUpdate | null => {
    const mediaId = readMediaId();
    if (mediaId === null || !activeVideo || isAdShowing(activePlayer)) return null;
    return {
      mediaId,
      title: document.title,
      positionSec: Number(activeVideo.currentTime.toFixed(3)),
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

  const playerObserver = new MutationObserver(scheduleRefresh);
  ctx.onInvalidated(() => playerObserver.disconnect());

  function refresh() {
    const video = document.querySelector<HTMLVideoElement>(
      '#movie_player video, video.html5-main-video, video',
    );
    if (video !== activeVideo) {
      if (activeVideo) {
        for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, onVideoEvent);
      }
      activeVideo = video;
      if (activeVideo) {
        for (const e of VIDEO_EVENTS) activeVideo.addEventListener(e, onVideoEvent);
      }
    }

    const player = findPlayer(activeVideo);
    if (player !== activePlayer) {
      playerObserver.disconnect();
      activePlayer = player;
      if (activePlayer) {
        playerObserver.observe(activePlayer, { attributes: true, attributeFilter: ['class'] });
      }
    }

    const adShowing = isAdShowing(activePlayer);
    if (wasAdShowing && !adShowing) {
      suppressUntil = performance.now() + SUPPRESSION_MS;
      lastMediaId = null;
    }
    wasAdShowing = adShowing;

    sendContextIfChanged();
  }

  function scheduleRefresh() {
    if (pendingFrame !== null) return;
    pendingFrame = ctx.requestAnimationFrame(() => {
      pendingFrame = null;
      refresh();
    });
  }

  const pageObserver = new MutationObserver(scheduleRefresh);
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  ctx.onInvalidated(() => pageObserver.disconnect());

  ctx.addEventListener(window, 'wxt:locationchange', scheduleRefresh);

  ctx.onInvalidated(onMessage('party:request-playback', () => readPlayback()));

  ctx.onInvalidated(
    onMessage('party:apply-snapshot', ({ data }) => {
      if (!activeVideo || readMediaId() === null) return;
      if (isAdShowing(activePlayer)) return;

      suppressUntil = performance.now() + SUPPRESSION_MS;

      const { positionSec, playing } = data.playback;
      if (Math.abs(activeVideo.currentTime - positionSec) > SEEK_THRESHOLD_SEC) {
        activeVideo.currentTime = positionSec;
      }
      if (playing && activeVideo.paused) {
        void activeVideo.play().catch(() => undefined);
      } else if (!playing && !activeVideo.paused) {
        activeVideo.pause();
      }
    }),
  );

  refresh();
}
