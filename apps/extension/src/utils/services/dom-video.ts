import type { PartySnapshot, ServiceId } from '@watch-party/shared';

import {
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

interface DomPlaybackState {
  readonly video: HTMLVideoElement | null;
  readonly mediaId: string | undefined;
  readonly mediaTitle: string;
  readonly isWatchPage: boolean;
}

interface SnapshotPlaybackTarget {
  readonly video: HTMLVideoElement;
  readonly targetPositionSec: number;
  readonly shouldPlay: boolean;
}

interface SuppressedPlaybackUpdate {
  readonly mediaId: string;
  readonly playing: boolean;
  readonly positionSec: number;
}

function buildPlaybackState(
  getVideo: () => HTMLVideoElement | null,
  matchMediaId: (location: Location) => string | undefined,
  getMediaTitle: () => string,
): DomPlaybackState {
  const video = getVideo();
  const mediaId = matchMediaId(window.location);

  return {
    video,
    mediaId,
    mediaTitle: getMediaTitle(),
    isWatchPage: Boolean(mediaId),
  };
}

function buildContextFromState(
  state: DomPlaybackState,
  config: DomVideoAdapterConfig,
): ServiceContentContext {
  const { video, mediaId, mediaTitle, isWatchPage } = state;

  return {
    serviceId: config.serviceId,
    href: window.location.href,
    title: document.title,
    mediaId,
    mediaTitle,
    playbackReady: Boolean(isWatchPage && video),
    playing: video ? !video.paused : false,
    positionSec: video ? Number(video.currentTime.toFixed(3)) : 0,
    issue: !isWatchPage
      ? config.issueWhenNoMedia
      : video
        ? undefined
        : config.issueWhenPlayerNotReady,
  };
}

function isSameContext(
  left: ServiceContentContext | null,
  right: ServiceContentContext,
): boolean {
  return (
    left?.href === right.href &&
    left.mediaId === right.mediaId &&
    left.mediaTitle === right.mediaTitle &&
    left.playbackReady === right.playbackReady &&
    left.playing === right.playing &&
    left.issue === right.issue
  );
}

function getSuppressedPlaybackUpdate(
  context: ServiceContentContext,
): SuppressedPlaybackUpdate | null {
  if (!context.playbackReady || !context.mediaId) {
    return null;
  }

  return {
    mediaId: context.mediaId,
    playing: context.playing,
    positionSec: context.positionSec,
  };
}

function isSuppressedPlaybackUpdate(
  suppressed: SuppressedPlaybackUpdate | null,
  context: ServiceContentContext,
): boolean {
  if (!suppressed || !context.playbackReady || !context.mediaId) {
    return false;
  }

  if (
    suppressed.mediaId !== context.mediaId ||
    suppressed.playing !== context.playing
  ) {
    return false;
  }

  return (
    Math.abs(suppressed.positionSec - context.positionSec) <=
    SYNC_DRIFT_THRESHOLD_SEC
  );
}

function getSnapshotPlaybackTarget(
  snapshot: PartySnapshot,
  context: ServiceContentContext,
  video: HTMLVideoElement | null,
  issueWhenPlayerNotReady: string,
): SnapshotPlaybackTarget | ApplySnapshotResult {
  if (!video || !context.playbackReady) {
    return {
      applied: false,
      reason: issueWhenPlayerNotReady,
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

  const elapsedSec = snapshot.playback.playing
    ? Math.max(0, (Date.now() - snapshot.playback.updatedAt) / 1000)
    : 0;

  return {
    video,
    targetPositionSec: snapshot.playback.positionSec + elapsedSec,
    shouldPlay: snapshot.playback.playing,
  };
}

function syncVideoPosition(
  video: HTMLVideoElement,
  targetPositionSec: number,
): void {
  if (Math.abs(video.currentTime - targetPositionSec) > SYNC_DRIFT_THRESHOLD_SEC) {
    video.currentTime = targetPositionSec;
  }
}

async function syncVideoPlaybackState(
  video: HTMLVideoElement,
  shouldPlay: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (shouldPlay && video.paused) {
    try {
      await video.play();
    } catch {
      return {
        ok: false,
        reason: 'Browser blocked playback start on this tab.',
      };
    }
  }

  if (!shouldPlay && !video.paused) {
    video.pause();
  }

  return { ok: true };
}

function observeUrlChanges(onChange: () => void): () => void {
  const { navigation } = window;
  navigation.addEventListener('navigatesuccess', onChange);

  return () => {
    navigation.removeEventListener('navigatesuccess', onChange);
  };
}

/**
 * Generic adapter for any service that exposes a plain HTML5 `<video>` element
 * on its watch page. Fully event-driven — no polling. It observes:
 *   - DOM structure (the <video> being added/removed/swapped by an SPA),
 *   - `<title>` text (so the popup label stays in sync),
 *   - URL changes via the Navigation API,
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

  const readPlaybackState = (): DomPlaybackState =>
    buildPlaybackState(getVideo, config.matchMediaId, getMediaTitle);

  const getContextFromState = (state: DomPlaybackState): ServiceContentContext =>
    buildContextFromState(state, config);

  const readContext = (): ServiceContentContext => getContextFromState(readPlaybackState());

  let suppressedPlaybackUpdate: SuppressedPlaybackUpdate | null = null;

  const applySuppressedPlaybackUpdate = (context: ServiceContentContext) => {
    if (isSuppressedPlaybackUpdate(suppressedPlaybackUpdate, context)) {
      suppressedPlaybackUpdate = null;
      return true;
    }

    if (suppressedPlaybackUpdate && context.mediaId !== suppressedPlaybackUpdate.mediaId) {
      suppressedPlaybackUpdate = null;
    }

    return false;
  };

  const setSuppressedPlaybackUpdate = (context: ServiceContentContext) => {
    suppressedPlaybackUpdate = getSuppressedPlaybackUpdate(context);
  };

  return {
    serviceId: config.serviceId,
    getContext: readContext,

    observe(onContext, onPlaybackUpdate) {
      let activeVideo: HTMLVideoElement | null = null;
      let lastContext: ServiceContentContext | null = null;
      let stopped = false;

      const emitContext = (context: ServiceContentContext) => {
        if (isSameContext(lastContext, context)) return;
        lastContext = context;
        onContext(context);
      };

      const emitPlaybackUpdate = (context: ServiceContentContext) => {
        if (applySuppressedPlaybackUpdate(context)) return;
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
        const state = readPlaybackState();
        const context = getContextFromState(state);
        bindActiveVideo(state.video);
        emitContext(context);
        emitPlaybackUpdate(context);
      };

      const bindActiveVideo = (video: HTMLVideoElement | null) => {
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

      const refresh = () => {
        if (stopped) return;
        const state = readPlaybackState();
        bindActiveVideo(state.video);
        emitContext(getContextFromState(state));
      };

      // Coalesce synchronous bursts of mutations / URL events into one
      // microtask so refreshes run promptly without depending on paint or
      // timer scheduling.
      let refreshQueued = false;
      const scheduleRefresh = () => {
        if (stopped || refreshQueued) return;
        refreshQueued = true;
        queueMicrotask(() => {
          refreshQueued = false;
          if (stopped) return;
          refresh();
        });
      };

      // SPA re-renders (Netflix, YouTube) swap or reparent the <video>
      // element. Subtree childList catches these regardless of depth.
      const structureObserver = new MutationObserver(scheduleRefresh);
      structureObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      // Title edits don't always show up as structural changes (a script
      // can just reassign `document.title`), so observe <head> for
      // characterData too. Head is tiny, so this is cheap.
      const titleObserver = new MutationObserver(scheduleRefresh);
      titleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const stopObservingUrl = observeUrlChanges(scheduleRefresh);

      refresh();

      return () => {
        stopped = true;
        structureObserver.disconnect();
        titleObserver.disconnect();
        stopObservingUrl();
        if (activeVideo) {
          for (const e of VIDEO_EVENTS) {
            activeVideo.removeEventListener(e, handleVideoEvent);
          }
          activeVideo = null;
        }
      };
    },

    async applySnapshot(snapshot: PartySnapshot): Promise<ApplySnapshotResult> {
      const state = readPlaybackState();
      const context = getContextFromState(state);
      const target = getSnapshotPlaybackTarget(
        snapshot,
        context,
        state.video,
        config.issueWhenPlayerNotReady,
      );

      if (!('video' in target)) {
        return target;
      }

      syncVideoPosition(target.video, target.targetPositionSec);

      const playbackResult = await syncVideoPlaybackState(
        target.video,
        target.shouldPlay,
      );
      if (!playbackResult.ok) {
        return {
          applied: false,
          reason: playbackResult.reason,
          context: readContext(),
        };
      }

      const appliedContext = readContext();
      setSuppressedPlaybackUpdate(appliedContext);
      return { applied: true, context: appliedContext };
    },
  };
}
