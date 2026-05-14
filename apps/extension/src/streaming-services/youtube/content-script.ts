import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { onMessage, sendMessage, type ReadyWatchReport, type WatchReport } from '../../messaging';
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
  let currentMediaId: string | null = null;
  let hasSeenMedia = false;
  let timelineReady = false;
  let wasAdShowing = false;
  let suppressUntil = 0;
  let pendingFrame: number | null = null;

  const readMediaId = (): string | null => {
    const mediaId = YOUTUBE.extractMediaId(new URL(location.href));
    if (!activeVideo || mediaId === null) return null;
    return mediaId;
  };

  const readWatchReport = (): ReadyWatchReport | null => {
    const mediaId = readMediaId();
    if (
      mediaId === null ||
      !activeVideo ||
      !timelineReady ||
      performance.now() < suppressUntil ||
      isAdShowing(activePlayer)
    ) {
      return null;
    }

    return {
      streamingServiceId: 'youtube',
      mediaId,
      phase: 'ready',
      title: document.title,
      positionSec: Number(activeVideo.currentTime.toFixed(3)),
      playing: !activeVideo.paused,
    };
  };

  const sendReport = (report: WatchReport) => {
    void sendMessage('content:watch-report', report).catch(() => undefined);
  };

  const syncMediaGeneration = () => {
    const mediaId = YOUTUBE.extractMediaId(new URL(location.href));
    if (mediaId === currentMediaId) return;

    const isInitialMedia = !hasSeenMedia;
    currentMediaId = mediaId;
    hasSeenMedia = true;
    timelineReady = isInitialMedia && Boolean(activeVideo?.readyState);

    if (mediaId !== null) {
      sendReport({
        streamingServiceId: 'youtube',
        mediaId,
        phase: 'loading',
      });
    }
  };

  const sendPlaybackReport = () => {
    const report = readWatchReport();
    if (report) sendReport(report);
  };

  const onVideoEvent = (event: Event) => {
    refresh();
    if (!timelineReady && event.type !== 'loadedmetadata') return;

    timelineReady = true;
    sendPlaybackReport();
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
      timelineReady = false;
      syncMediaGeneration();
    }
    wasAdShowing = adShowing;

    syncMediaGeneration();
    sendPlaybackReport();
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

  ctx.onInvalidated(onMessage('party:request-watch-report', () => readWatchReport()));

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
