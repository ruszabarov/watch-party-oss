import type { PlaybackUpdateDraft } from '@open-watch-party/shared';
import { defineContentScript } from 'wxt/utils/define-content-script';

import type { ServiceContentContext } from '../protocol/extension';
import { onMessage, sendMessage } from '../protocol/messaging';
import type { ServicePlugin } from './types';

const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'loadedmetadata', 'emptied', 'ended'] as const;
const SEEK_CORRECTION_THRESHOLD_SEC = 1.5;

interface DomPlaybackState {
  readonly video: HTMLVideoElement | null;
  readonly mediaId: string | undefined;
  readonly mediaTitle: string;
  readonly isWatchPage: boolean;
}

function buildPlaybackState(plugin: ServicePlugin): DomPlaybackState {
  const parsedUrl = plugin.parseUrl(window.location.href);

  return {
    video: plugin.getVideo(),
    mediaId: parsedUrl?.mediaId,
    mediaTitle: plugin.getMediaTitle(),
    isWatchPage: Boolean(parsedUrl?.mediaId),
  };
}

function buildContextFromState(
  state: DomPlaybackState,
  plugin: ServicePlugin,
): ServiceContentContext {
  const { video, mediaId, mediaTitle, isWatchPage } = state;
  const issue = !isWatchPage
    ? plugin.issues.noMedia
    : video
      ? undefined
      : plugin.issues.playerNotReady;

  return {
    serviceId: plugin.id,
    href: window.location.href,
    title: document.title,
    mediaTitle,
    playbackReady: Boolean(isWatchPage && video),
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
    left.issue === right.issue
  );
}

function buildPlaybackUpdate(
  state: DomPlaybackState,
  plugin: ServicePlugin,
): PlaybackUpdateDraft | null {
  if (!state.video || !state.mediaId) {
    return null;
  }

  return {
    serviceId: plugin.id,
    mediaId: state.mediaId,
    title: state.mediaTitle,
    positionSec: Number(state.video.currentTime.toFixed(3)),
    playing: !state.video.paused,
  };
}

function observeUrlChanges(onChange: () => void): () => void {
  const { navigation } = window;
  navigation.addEventListener('navigatesuccess', onChange);

  return () => {
    navigation.removeEventListener('navigatesuccess', onChange);
  };
}

function applyHtml5Playback(
  video: HTMLVideoElement,
  target: { positionSec: number; playing: boolean },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (Math.abs(video.currentTime - target.positionSec) > SEEK_CORRECTION_THRESHOLD_SEC) {
    video.currentTime = target.positionSec;
  }

  if (target.playing && video.paused) {
    return video
      .play()
      .then(() => ({ ok: true }) as const)
      .catch(() => ({
        ok: false,
        reason: 'Browser blocked playback start on this tab.',
      }));
  }

  if (!target.playing && !video.paused) {
    video.pause();
  }

  return Promise.resolve({ ok: true });
}

export function runServiceContentScript(plugin: ServicePlugin) {
  return defineContentScript({
    matches: [...plugin.contentMatches],
    main() {
      const readPlaybackState = (): DomPlaybackState => buildPlaybackState(plugin);
      const getContextFromState = (state: DomPlaybackState): ServiceContentContext =>
        buildContextFromState(state, plugin);
      const readContext = (): ServiceContentContext => getContextFromState(readPlaybackState());
      const readPlaybackUpdate = (): PlaybackUpdateDraft | null =>
        buildPlaybackUpdate(readPlaybackState(), plugin);

      let lastReadyMediaKey: string | null = null;
      let pendingAppliedPlaybackState: {
        readonly mediaId: string;
        readonly playing: boolean;
        readonly positionSec: number;
      } | null = null;

      const emitContentContext = (context: ServiceContentContext) => {
        const readyMediaKey =
          context.playbackReady && context.mediaId ? `${context.href}::${context.mediaId}` : null;

        if (readyMediaKey && lastReadyMediaKey && readyMediaKey !== lastReadyMediaKey) {
          void sendMessage('content:request-sync').catch(() => undefined);
        }

        lastReadyMediaKey = readyMediaKey;
        void sendMessage('content:context', context).catch(() => undefined);
      };

      const emitPlaybackUpdate = (state: DomPlaybackState) => {
        const update = buildPlaybackUpdate(state, plugin);
        if (!update) return;

        if (pendingAppliedPlaybackState) {
          if (
            pendingAppliedPlaybackState.mediaId === update.mediaId &&
            pendingAppliedPlaybackState.playing === update.playing &&
            Math.abs(pendingAppliedPlaybackState.positionSec - update.positionSec) <=
              SEEK_CORRECTION_THRESHOLD_SEC
          ) {
            pendingAppliedPlaybackState = null;
            return;
          }

          if (update.mediaId !== pendingAppliedPlaybackState.mediaId) {
            pendingAppliedPlaybackState = null;
          }
        }

        void sendMessage('content:playback-update', update).catch(() => undefined);
      };

      let activeVideo: HTMLVideoElement | null = null;
      let lastContext: ServiceContentContext | null = null;
      let structureObservedRoot: Node | null = null;
      let stopped = false;

      const emitContext = (context: ServiceContentContext) => {
        if (isSameContext(lastContext, context)) return;
        lastContext = context;
        emitContentContext(context);
      };

      const handleVideoEvent = () => {
        const state = readPlaybackState();
        const context = getContextFromState(state);
        bindActiveVideo(state.video);
        emitContext(context);
        emitPlaybackUpdate(state);
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
        const nextRoot = plugin.getStructureRoot?.() ?? document.body;
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

      const titleObserver = new MutationObserver(scheduleRefresh);
      titleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const stopObservingUrl = observeUrlChanges(scheduleRefresh);

      refresh();
      void sendMessage('content:request-sync').catch(() => undefined);

      const removeContextListener = onMessage('party:request-context', () => {
        return readContext();
      });

      const removePlaybackListener = onMessage('party:request-playback', () => {
        return readPlaybackUpdate();
      });

      const removeSnapshotListener = onMessage('party:apply-snapshot', async ({ data }) => {
        const state = readPlaybackState();
        const context = getContextFromState(state);

        if (!state.video || !context.playbackReady) {
          return {
            applied: false,
            reason: plugin.issues.playerNotReady,
            context,
          };
        }

        let playbackResult = plugin.apply
          ? await plugin.apply(state.video, {
              positionSec: data.snapshot.playback.positionSec,
              playing: data.snapshot.playback.playing,
            })
          : null;

        if (!playbackResult) {
          playbackResult = await applyHtml5Playback(state.video, {
            positionSec: data.snapshot.playback.positionSec,
            playing: data.snapshot.playback.playing,
          });
        }

        if (!playbackResult.ok) {
          return {
            applied: false,
            reason: playbackResult.reason,
            context: readContext(),
          };
        }

        pendingAppliedPlaybackState = {
          mediaId: data.snapshot.playback.mediaId,
          playing: data.snapshot.playback.playing,
          positionSec: data.snapshot.playback.positionSec,
        };

        const appliedContext = readContext();
        return { applied: true, context: appliedContext };
      });

      window.addEventListener('beforeunload', () => {
        stopped = true;
        structureObserver.disconnect();
        titleObserver.disconnect();
        stopObservingUrl();
        removeContextListener();
        removePlaybackListener();
        removeSnapshotListener();
        if (activeVideo) {
          for (const e of VIDEO_EVENTS) {
            activeVideo.removeEventListener(e, handleVideoEvent);
          }
          activeVideo = null;
        }
      });
    },
  });
}
