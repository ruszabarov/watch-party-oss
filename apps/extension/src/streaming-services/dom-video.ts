import type { PlaybackUpdate, StreamingServiceId } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import type { ApplySnapshotResult, WatchPageContext } from '../messaging';
import { onMessage, sendMessage } from '../messaging';
import type { PlaybackApplyContext, PlaybackStatus, StreamingServiceIntegration } from './types';

const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'ended'] as const;
const SEEK_THRESHOLD_SEC = 1.5;
const APPLIED_SNAPSHOT_EVENT_SUPPRESSION_MS = 750;

const SYNCABLE_PLAYBACK_STATUS: PlaybackStatus = { syncable: true };

async function applyHtml5Playback({
  video,
  snapshot,
}: PlaybackApplyContext): Promise<ApplySnapshotResult> {
  const target = {
    positionSec: snapshot.playback.positionSec,
    playing: snapshot.playback.playing,
  };

  if (Math.abs(video.currentTime - target.positionSec) > SEEK_THRESHOLD_SEC) {
    video.currentTime = target.positionSec;
  }

  if (target.playing && video.paused) {
    try {
      await video.play();
    } catch {
      return { applied: false, reason: 'Browser blocked playback start on this tab.' };
    }
  }

  if (!target.playing && !video.paused) {
    video.pause();
  }

  return { applied: true };
}

export function runStreamingServiceContentScript(
  streamingServiceId: StreamingServiceId,
  integration: StreamingServiceIntegration,
) {
  return defineContentScript({
    matches: [...integration.contentMatches],
    main() {
      let activeVideo: HTMLVideoElement | null = null;
      let lastContextKey: string | null = null;
      let playbackStatusTarget: Element | null = null;
      let playbackWasBlocked = false;
      let suppressPlaybackEventsUntil = 0;
      let refreshFrame: number | null = null;
      let stopped = false;

      const getPlaybackStatus = (): PlaybackStatus | null => {
        if (!activeVideo) return null;
        return integration.getPlaybackStatus?.(activeVideo) ?? SYNCABLE_PLAYBACK_STATUS;
      };

      const readContext = (): WatchPageContext | null => {
        const mediaId = integration.extractMediaId(new URL(window.location.href));
        if (!activeVideo || mediaId === null) return null;

        return {
          streamingServiceId,
          mediaId,
          title: integration.getMediaTitle() || undefined,
        };
      };

      const readPlayback = (): PlaybackUpdate | null => {
        const mediaId = integration.extractMediaId(new URL(window.location.href));
        if (!activeVideo || mediaId === null) return null;
        if (getPlaybackStatus()?.syncable === false) return null;

        return {
          streamingServiceId,
          mediaId,
          title: integration.getMediaTitle(),
          positionSec: Number(activeVideo.currentTime.toFixed(3)),
          playing: !activeVideo.paused,
        };
      };

      const sendContextIfChanged = (force = false) => {
        const context = readContext();
        const key = context ? `${context.streamingServiceId}::${context.mediaId}` : null;

        if (!force && key === lastContextKey) return;
        lastContextKey = key;

        if (context) {
          void sendMessage('content:context', context).catch(() => undefined);
        }
      };

      const sendPlaybackUpdate = () => {
        if (performance.now() < suppressPlaybackEventsUntil) {
          return;
        }

        const update = readPlayback();
        if (update) {
          void sendMessage('content:playback-update', update).catch(() => undefined);
        }
      };

      const handleVideoEvent = () => {
        refresh();
        sendPlaybackUpdate();
      };

      const scheduleRefresh = () => {
        if (stopped || refreshFrame !== null) return;
        refreshFrame = window.requestAnimationFrame(() => {
          refreshFrame = null;
          refresh();
        });
      };

      const pageObserver = new MutationObserver(scheduleRefresh);
      const playbackStatusObserver = new MutationObserver(scheduleRefresh);

      const bindVideo = () => {
        const video = integration.getVideo();
        if (video === activeVideo) return;

        if (activeVideo) {
          for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, handleVideoEvent);
        }

        activeVideo = video;

        if (activeVideo) {
          for (const e of VIDEO_EVENTS) activeVideo.addEventListener(e, handleVideoEvent);
        }
      };

      const bindPlaybackStatusTarget = () => {
        const target = activeVideo
          ? (integration.getPlaybackStatusTarget?.(activeVideo) ?? null)
          : null;
        if (target === playbackStatusTarget) return;

        playbackStatusObserver.disconnect();
        playbackStatusTarget = target;

        if (playbackStatusTarget) {
          playbackStatusObserver.observe(playbackStatusTarget, {
            attributes: true,
            attributeFilter: ['class'],
          });
        }
      };

      function refresh() {
        if (stopped) return;
        bindVideo();
        bindPlaybackStatusTarget();

        const playbackBlocked = getPlaybackStatus()?.syncable === false;
        const playbackJustUnblocked = playbackWasBlocked && !playbackBlocked;
        playbackWasBlocked = playbackBlocked;

        if (playbackJustUnblocked) {
          suppressPlaybackEventsUntil = performance.now() + APPLIED_SNAPSHOT_EVENT_SUPPRESSION_MS;
          sendContextIfChanged(true);
          return;
        }

        sendContextIfChanged();
      }

      pageObserver.observe(document.documentElement, { childList: true, subtree: true });

      const navigation = window.navigation;
      navigation?.addEventListener('navigatesuccess', scheduleRefresh);
      window.addEventListener('popstate', scheduleRefresh);

      const cleanups: Array<() => void> = [];

      cleanups.push(onMessage('party:request-context', () => readContext()));
      cleanups.push(onMessage('party:request-playback', () => readPlayback()));

      cleanups.push(
        onMessage('party:apply-snapshot', async ({ data }) => {
          if (!activeVideo || !readContext()) {
            return { applied: false, reason: integration.playerNotReadyMessage };
          }

          const playbackStatus = getPlaybackStatus();
          if (playbackStatus?.syncable === false) {
            return { applied: false, reason: playbackStatus.reason };
          }

          suppressPlaybackEventsUntil = performance.now() + APPLIED_SNAPSHOT_EVENT_SUPPRESSION_MS;

          const result = await (integration.applyPlayback ?? applyHtml5Playback)({
            video: activeVideo,
            snapshot: data,
          }).catch(() => ({
            applied: false,
            reason: 'Sync failed on this tab.',
          }));

          if (result.applied) {
            suppressPlaybackEventsUntil = performance.now() + APPLIED_SNAPSHOT_EVENT_SUPPRESSION_MS;
          }

          return result;
        }),
      );

      refresh();

      window.addEventListener(
        'beforeunload',
        () => {
          stopped = true;
          pageObserver.disconnect();
          playbackStatusObserver.disconnect();
          navigation?.removeEventListener('navigatesuccess', scheduleRefresh);
          window.removeEventListener('popstate', scheduleRefresh);

          if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);

          if (activeVideo) {
            for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, handleVideoEvent);
          }

          for (const fn of cleanups) fn();
        },
        { once: true },
      );
    },
  });
}
