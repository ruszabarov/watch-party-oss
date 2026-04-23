import type { PartySnapshot, ServiceId } from '@watch-party/shared';

import {
  LOCAL_UPDATE_SUPPRESSION_MS,
  SYNC_DRIFT_THRESHOLD_SEC,
  type ApplySnapshotResult,
  type ServiceContentContext,
} from '../protocol/extension';
import type { StreamingServiceAdapter } from './types';

export interface DomVideoAdapterConfig {
  readonly serviceId: ServiceId;
  /** Selector for the main `<video>` element. Defaults to `video`. */
  readonly videoSelector?: string;
  /**
   * Parse the media id out of `window.location`. Returning `undefined`
   * means the current page is not a watch page (popup will show `issueWhenNoMedia`).
   */
  matchMediaId(location: Location): string | undefined;
  /** Human-readable title shown in the popup. Defaults to `document.title`. */
  matchMediaTitle?(doc: Document): string;
  /** Shown when the user is on the service but not on a playable page. */
  readonly issueWhenNoMedia: string;
  /** Shown when a watch URL matched but the `<video>` element isn't ready. */
  readonly issueWhenPlayerNotReady: string;
}

// Events that describe any meaningful change to the current media:
//   play/pause/seeked — user-driven playback state.
//   loadedmetadata/emptied/ended — source swaps (e.g. SPA nav that reuses
//   the same <video> element) and natural playback completion.
const VIDEO_EVENTS = [
  'play',
  'pause',
  'seeked',
  'loadedmetadata',
  'emptied',
  'ended',
] as const;

// URL transitions we can hear about without page reload. The Navigation API
// covers in-page `history.pushState` on Chromium; `popstate`/`hashchange`
// cover back/forward and anchor navigation everywhere.
const URL_EVENTS = ['popstate', 'hashchange'] as const;

interface NavigationEventTarget {
  addEventListener(type: 'navigatesuccess', listener: () => void): void;
  removeEventListener(type: 'navigatesuccess', listener: () => void): void;
}

/**
 * Generic adapter for any service that exposes a plain HTML5 `<video>` element
 * on its watch page. Fully event-driven — no polling. It observes:
 *   - DOM structure (the <video> being added/removed/swapped by an SPA),
 *   - `<title>` text (so the popup label stays in sync),
 *   - URL changes (popstate/hashchange + Navigation API for pushState),
 *   - the video element's own playback events.
 * Services only need to supply matchers + UI copy.
 */
export function createDomVideoAdapter(
  config: DomVideoAdapterConfig,
): StreamingServiceAdapter {
  const videoSelector = config.videoSelector ?? 'video';
  const getVideo = () => document.querySelector<HTMLVideoElement>(videoSelector);
  const getMediaTitle = () =>
    config.matchMediaTitle?.(document) ?? document.title;

  const buildContext = (): ServiceContentContext => {
    const video = getVideo();
    const mediaId = config.matchMediaId(window.location);
    const isWatchPage = Boolean(mediaId);

    return {
      serviceId: config.serviceId,
      href: window.location.href,
      title: document.title,
      mediaId,
      mediaTitle: getMediaTitle(),
      playbackReady: Boolean(isWatchPage && video),
      playing: video ? !video.paused : false,
      positionSec: video ? Number(video.currentTime.toFixed(3)) : 0,
      issue: !isWatchPage
        ? config.issueWhenNoMedia
        : video
          ? undefined
          : config.issueWhenPlayerNotReady,
    };
  };

  let activeVideo: HTMLVideoElement | null = null;
  let suppressLocalCommandsUntil = 0;

  return {
    serviceId: config.serviceId,
    getContext: buildContext,

    observe(onContext, onPlaybackUpdate) {
      let lastSignature = '';

      const emitContext = () => {
        const context = buildContext();
        const signature = JSON.stringify([
          context.href,
          context.mediaId,
          context.mediaTitle,
          context.playbackReady,
          context.playing,
          context.issue,
        ]);
        if (signature === lastSignature) return;
        lastSignature = signature;
        onContext(context);
      };

      const emitPlaybackUpdate = () => {
        if (Date.now() < suppressLocalCommandsUntil) return;
        const context = buildContext();
        if (!context.playbackReady || !context.mediaId) return;
        onPlaybackUpdate({
          serviceId: config.serviceId,
          mediaId: context.mediaId,
          title: context.mediaTitle,
          positionSec: context.positionSec,
          playing: context.playing,
          issuedAt: Date.now(),
        });
      };

      const handleVideoEvent = () => {
        emitContext();
        emitPlaybackUpdate();
      };

      const bindActiveVideo = () => {
        const video = getVideo();
        if (video === activeVideo) return;
        if (activeVideo) {
          for (const e of VIDEO_EVENTS) {
            activeVideo.removeEventListener(e, handleVideoEvent);
          }
        }
        activeVideo = video;
        if (activeVideo) {
          for (const e of VIDEO_EVENTS) {
            activeVideo.addEventListener(e, handleVideoEvent);
          }
        }
      };

      // Coalesce bursts of mutations / URL events into one refresh per frame.
      let rafId: number | null = null;
      const refresh = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          bindActiveVideo();
          emitContext();
        });
      };

      // SPA re-renders (Netflix, YouTube) swap or reparent the <video>
      // element. Subtree childList catches these regardless of depth.
      const structureObserver = new MutationObserver(refresh);
      structureObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      // Title edits don't always show up as structural changes (a script
      // can just reassign `document.title`), so observe <head> for
      // characterData too. Head is tiny, so this is cheap.
      const titleObserver = new MutationObserver(refresh);
      titleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      for (const e of URL_EVENTS) {
        window.addEventListener(e, refresh);
      }
      const navigation = (window as unknown as {
        navigation?: NavigationEventTarget;
      }).navigation;
      navigation?.addEventListener('navigatesuccess', refresh);

      bindActiveVideo();
      emitContext();

      return () => {
        structureObserver.disconnect();
        titleObserver.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
        for (const e of URL_EVENTS) {
          window.removeEventListener(e, refresh);
        }
        navigation?.removeEventListener('navigatesuccess', refresh);
        if (activeVideo) {
          for (const e of VIDEO_EVENTS) {
            activeVideo.removeEventListener(e, handleVideoEvent);
          }
          activeVideo = null;
        }
      };
    },

    async applySnapshot(snapshot: PartySnapshot): Promise<ApplySnapshotResult> {
      const video = getVideo();
      const context = buildContext();

      if (!video || !context.playbackReady) {
        return {
          applied: false,
          reason: config.issueWhenPlayerNotReady,
          context,
        };
      }

      if (context.mediaId && snapshot.playback.mediaId !== context.mediaId) {
        return {
          applied: false,
          reason: 'Current media does not match the room playback.',
          context,
        };
      }

      suppressLocalCommandsUntil = Date.now() + LOCAL_UPDATE_SUPPRESSION_MS;

      const elapsedSec = snapshot.playback.playing
        ? Math.max(0, (Date.now() - snapshot.playback.updatedAt) / 1000)
        : 0;
      const targetPosition = snapshot.playback.positionSec + elapsedSec;

      if (Math.abs(video.currentTime - targetPosition) > SYNC_DRIFT_THRESHOLD_SEC) {
        video.currentTime = targetPosition;
      }

      if (snapshot.playback.playing && video.paused) {
        try {
          await video.play();
        } catch {
          return {
            applied: false,
            reason: 'Browser blocked playback start on this tab.',
            context: buildContext(),
          };
        }
      }

      if (!snapshot.playback.playing && !video.paused) {
        video.pause();
      }

      return { applied: true, context: buildContext() };
    },
  };
}
