import type { PartySnapshot, ServiceId } from '@open-watch-party/shared';

import { type ApplySnapshotResult, type ServiceContentContext } from '../protocol/extension';
import type { MediaLocator } from './media-locators';
import { createHtml5PlaybackController, type PlaybackController } from './playback-controllers';
import type { StreamingServiceAdapter } from './types';

// Events that describe any meaningful change to the current media:
//   play/pause/seeked — user-driven playback state.
//   loadedmetadata/emptied/ended — source swaps (e.g. SPA nav that reuses
//   the same <video> element) and natural playback completion.
const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'emptied', 'ended'] as const;

export interface DomVideoAdapterConfig {
  readonly serviceId: ServiceId;
  readonly locator: MediaLocator;
  readonly playbackController?: PlaybackController;
  /** Shown when the user is on the service but not on a playable page. */
  readonly issueWhenNoMedia: string;
  /** Shown when a watch URL matched but the `<video>` element isn't ready. */
  readonly issueWhenPlayerNotReady: string;
}

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

interface PendingAppliedPlaybackState {
  readonly mediaId: string;
  readonly playing: boolean;
  readonly positionSec: number;
}

function buildPlaybackState(locator: MediaLocator): DomPlaybackState {
  const video = locator.getVideo();
  const mediaId = locator.getMediaId(window.location);

  return {
    video,
    mediaId,
    mediaTitle: locator.getMediaTitle(document),
    isWatchPage: Boolean(mediaId),
  };
}

function buildContextFromState(
  state: DomPlaybackState,
  config: DomVideoAdapterConfig,
): ServiceContentContext {
  const { video, mediaId, mediaTitle, isWatchPage } = state;
  const issue = !isWatchPage
    ? config.issueWhenNoMedia
    : video
      ? undefined
      : config.issueWhenPlayerNotReady;

  return {
    serviceId: config.serviceId,
    href: window.location.href,
    title: document.title,
    mediaTitle,
    playbackReady: Boolean(isWatchPage && video),
    playing: video ? !video.paused : false,
    positionSec: video ? Number(video.currentTime.toFixed(3)) : 0,
    ...(mediaId ? { mediaId } : {}),
    ...(issue ? { issue } : {}),
  };
}

function isSameContext(left: ServiceContentContext | null, right: ServiceContentContext): boolean {
  return (
    left?.href === right.href &&
    left.mediaId === right.mediaId &&
    left.mediaTitle === right.mediaTitle &&
    left.playbackReady === right.playbackReady &&
    left.playing === right.playing &&
    left.issue === right.issue
  );
}

function getPendingAppliedPlaybackState(
  context: ServiceContentContext,
): PendingAppliedPlaybackState | null {
  if (!context.playbackReady || !context.mediaId) {
    return null;
  }

  return {
    mediaId: context.mediaId,
    playing: context.playing,
    positionSec: context.positionSec,
  };
}

function matchesPendingAppliedPlaybackState(
  pendingState: PendingAppliedPlaybackState | null,
  context: ServiceContentContext,
): boolean {
  if (!pendingState || !context.playbackReady || !context.mediaId) {
    return false;
  }

  if (pendingState.mediaId !== context.mediaId || pendingState.playing !== context.playing) {
    return false;
  }

  return Math.abs(pendingState.positionSec - context.positionSec) <= 1.5;
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

  return {
    video,
    targetPositionSec: snapshot.playback.positionSec,
    shouldPlay: snapshot.playback.playing,
  };
}

function observeUrlChanges(onChange: () => void): () => void {
  const { navigation } = window;
  navigation.addEventListener('navigatesuccess', onChange);

  return () => {
    navigation.removeEventListener('navigatesuccess', onChange);
  };
}

/**
 * Generic adapter for services whose media state can be described by a
 * locator (discovery + observation root) and a playback controller (command
 * transport). The adapter owns the shared event wiring, context emission, and
 * snapshot bookkeeping; services only swap the pieces that truly vary.
 */
export function createDomVideoAdapter(config: DomVideoAdapterConfig): StreamingServiceAdapter {
  const playbackController = config.playbackController ?? createHtml5PlaybackController();

  const readPlaybackState = (): DomPlaybackState => buildPlaybackState(config.locator);

  const getContextFromState = (state: DomPlaybackState): ServiceContentContext =>
    buildContextFromState(state, config);

  const readContext = (): ServiceContentContext => getContextFromState(readPlaybackState());

  let pendingAppliedPlaybackState: PendingAppliedPlaybackState | null = null;

  const consumePendingAppliedPlaybackState = (context: ServiceContentContext) => {
    if (matchesPendingAppliedPlaybackState(pendingAppliedPlaybackState, context)) {
      pendingAppliedPlaybackState = null;
      return true;
    }

    if (pendingAppliedPlaybackState && context.mediaId !== pendingAppliedPlaybackState.mediaId) {
      pendingAppliedPlaybackState = null;
    }

    return false;
  };

  const rememberPendingAppliedPlaybackState = (context: ServiceContentContext) => {
    pendingAppliedPlaybackState = getPendingAppliedPlaybackState(context);
  };

  return {
    serviceId: config.serviceId,
    getContext: readContext,

    observe(onContext, onPlaybackUpdate) {
      let activeVideo: HTMLVideoElement | null = null;
      let lastContext: ServiceContentContext | null = null;
      let structureObservedRoot: Node | null = null;
      let stopped = false;

      const emitContext = (context: ServiceContentContext) => {
        if (isSameContext(lastContext, context)) return;
        lastContext = context;
        onContext(context);
      };

      const emitPlaybackUpdate = (context: ServiceContentContext) => {
        if (consumePendingAppliedPlaybackState(context)) return;
        if (!context.playbackReady || !context.mediaId) return;
        onPlaybackUpdate({
          serviceId: config.serviceId,
          mediaId: context.mediaId,
          title: context.mediaTitle,
          positionSec: context.positionSec,
          playing: context.playing,
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

      const structureObserver = new MutationObserver(scheduleRefresh);
      const bindStructureRoot = () => {
        const nextRoot = config.locator.getStructureRoot() ?? document.body;
        if (!nextRoot || nextRoot === structureObservedRoot) return;
        structureObserver.disconnect();
        structureObserver.observe(nextRoot, {
          childList: true,
          subtree: true,
        });
        structureObservedRoot = nextRoot;
      };

      const refresh = () => {
        if (stopped) return;
        const state = readPlaybackState();
        bindStructureRoot();
        bindActiveVideo(state.video);
        emitContext(getContextFromState(state));
      };

      // Coalesce synchronous bursts of mutations / URL events into one
      // microtask so refreshes run promptly without depending on paint or
      // timer scheduling.
      let refreshQueued = false;
      function scheduleRefresh() {
        if (stopped || refreshQueued) return;
        refreshQueued = true;
        queueMicrotask(() => {
          refreshQueued = false;
          if (stopped) return;
          refresh();
        });
      }

      // SPA re-renders swap or reparent the <video> element. Subtree childList
      // catches these regardless of depth once the correct observation root is
      // bound for the current service.

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

      const playbackResult = await playbackController.apply({
        video: target.video,
        targetPositionSec: target.targetPositionSec,
        shouldPlay: target.shouldPlay,
        context,
      });
      if (!playbackResult.ok) {
        return {
          applied: false,
          reason: playbackResult.reason,
          context: readContext(),
        };
      }

      const appliedContext = readContext();
      rememberPendingAppliedPlaybackState(appliedContext);
      return { applied: true, context: appliedContext };
    },
  };
}
