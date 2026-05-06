import type { PlaybackUpdateDraft, ServiceId } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import type { WatchPageContext } from '../protocol/extension';
import { onMessage, sendMessage } from '../protocol/messaging';
import { SERVICE_PLUGIN_BY_ID } from './plugins';

const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'ended'] as const;
const SEEK_THRESHOLD_SEC = 1.5;

export function runServiceContentScript(serviceId: ServiceId) {
  const plugin = SERVICE_PLUGIN_BY_ID[serviceId];

  return defineContentScript({
    matches: [...plugin.contentMatches],
    main() {
      let activeVideo: HTMLVideoElement | null = null;
      let lastContextKey: string | null = null;
      let suppressNextEvent = false;
      let refreshFrame: number | null = null;
      let stopped = false;

      const readContext = (): WatchPageContext | null => {
        const mediaId = plugin.extractMediaId(new URL(window.location.href));
        if (!activeVideo || mediaId === null) return null;

        return {
          serviceId,
          mediaId,
        };
      };

      const readPlayback = (): PlaybackUpdateDraft | null => {
        const mediaId = plugin.extractMediaId(new URL(window.location.href));
        if (!activeVideo || mediaId === null) return null;

        return {
          serviceId,
          mediaId,
          title: plugin.getMediaTitle(),
          positionSec: Number(activeVideo.currentTime.toFixed(3)),
          playing: !activeVideo.paused,
        };
      };

      const applyHtml5Playback = async (
        video: HTMLVideoElement,
        target: { positionSec: number; playing: boolean },
      ): Promise<{ ok: true } | { ok: false; reason: string }> => {
        if (Math.abs(video.currentTime - target.positionSec) > SEEK_THRESHOLD_SEC) {
          video.currentTime = target.positionSec;
        }

        if (target.playing && video.paused) {
          try {
            await video.play();
          } catch {
            return { ok: false, reason: 'Browser blocked playback start on this tab.' };
          }
        }

        if (!target.playing && !video.paused) {
          video.pause();
        }

        return { ok: true };
      };

      const sendContextIfChanged = () => {
        const context = readContext();
        const key = context ? `${context.serviceId}::${context.mediaId}` : null;

        if (key === lastContextKey) return;
        lastContextKey = key;

        void sendMessage('content:context', context).catch(() => undefined);
      };

      const sendPlaybackUpdate = () => {
        if (suppressNextEvent) {
          suppressNextEvent = false;
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

      const bindVideo = () => {
        const video = plugin.getVideo();
        if (video === activeVideo) return;

        if (activeVideo) {
          for (const e of VIDEO_EVENTS) activeVideo.removeEventListener(e, handleVideoEvent);
        }

        activeVideo = video;

        if (activeVideo) {
          for (const e of VIDEO_EVENTS) activeVideo.addEventListener(e, handleVideoEvent);
        }
      };

      function refresh() {
        if (stopped) return;
        bindVideo();
        sendContextIfChanged();
      }

      const scheduleRefresh = () => {
        if (stopped || refreshFrame !== null) return;
        refreshFrame = window.requestAnimationFrame(() => {
          refreshFrame = null;
          refresh();
        });
      };

      const pageObserver = new MutationObserver(scheduleRefresh);
      pageObserver.observe(document.documentElement, { childList: true, subtree: true });

      const navigation = (window as Window & { navigation?: EventTarget }).navigation;
      navigation?.addEventListener('navigatesuccess', scheduleRefresh);
      window.addEventListener('popstate', scheduleRefresh);

      refresh();
      void sendMessage('content:request-sync').catch(() => undefined);

      const cleanups: Array<() => void> = [];

      cleanups.push(onMessage('party:request-context', () => readContext()));
      cleanups.push(onMessage('party:request-playback', () => readPlayback()));

      cleanups.push(
        onMessage('party:apply-snapshot', async ({ data }) => {
          if (!activeVideo || !readContext()) {
            return { applied: false, reason: plugin.playerNotReadyMessage };
          }

          const target = {
            positionSec: data.snapshot.playback.positionSec,
            playing: data.snapshot.playback.playing,
          };

          suppressNextEvent = true;

          const result = await applyHtml5Playback(activeVideo, target);

          if (!result.ok) {
            suppressNextEvent = false;
          }

          return result.ok ? { applied: true } : { applied: false, reason: result.reason };
        }),
      );

      window.addEventListener(
        'beforeunload',
        () => {
          stopped = true;
          pageObserver.disconnect();
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
