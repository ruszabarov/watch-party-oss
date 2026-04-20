import type { PartySnapshot, PlaybackUpdate } from '@watch-party/shared';

import {
  LOCAL_UPDATE_SUPPRESSION_MS,
  SYNC_DRIFT_THRESHOLD_SEC,
  type ApplySnapshotResult,
  type ServiceContentContext,
} from '../protocol/extension';
import type { StreamingServiceAdapter } from './types';

const NETFLIX_SUFFIX = /\s*-\s*Netflix$/i;

export function createNetflixAdapter(): StreamingServiceAdapter {
  let activeVideo: HTMLVideoElement | null = null;
  let suppressLocalCommandsUntil = 0;
  let lastContextSignature = '';
  let notifyContext: ((context: ServiceContentContext) => void) | null = null;
  let notifyPlaybackUpdate: ((update: PlaybackUpdate) => void) | null = null;

  const onPlay = (): void => {
    if (!notifyContext || !notifyPlaybackUpdate) {
      return;
    }

    emitContextIfChanged(notifyContext);
    emitPlaybackUpdate(notifyPlaybackUpdate);
  };

  const onPause = (): void => {
    if (!notifyContext || !notifyPlaybackUpdate) {
      return;
    }

    emitContextIfChanged(notifyContext);
    emitPlaybackUpdate(notifyPlaybackUpdate);
  };

  const onSeeked = (): void => {
    if (!notifyContext || !notifyPlaybackUpdate) {
      return;
    }

    emitContextIfChanged(notifyContext);
    emitPlaybackUpdate(notifyPlaybackUpdate);
  };

  const getVideo = (): HTMLVideoElement | null => {
    return document.querySelector('video');
  };

  const getMediaId = (): string | undefined => {
    const match = window.location.pathname.match(/\/watch\/(\d+)/);
    return match?.[1];
  };

  const getContext = (): ServiceContentContext => {
    const video = getVideo();
    const mediaId = getMediaId();
    const isWatchPage = Boolean(mediaId);
    const title = document.title.replace(NETFLIX_SUFFIX, '').trim() || 'Netflix';

    return {
      serviceId: 'netflix',
      href: window.location.href,
      title: document.title,
      mediaId,
      mediaTitle: title,
      playbackReady: Boolean(isWatchPage && video),
      playing: video ? !video.paused : false,
      positionSec: video ? Number(video.currentTime.toFixed(3)) : 0,
      issue: isWatchPage ? (video ? undefined : 'Netflix player not ready.') : 'Open a Netflix watch page.',
    };
  };

  const emitContextIfChanged = (
    onContext: (context: ServiceContentContext) => void,
  ): void => {
    const context = getContext();
    const signature = JSON.stringify({
      href: context.href,
      mediaId: context.mediaId,
      mediaTitle: context.mediaTitle,
      playbackReady: context.playbackReady,
      playing: context.playing,
      issue: context.issue,
    });
    if (signature === lastContextSignature) {
      return;
    }

    lastContextSignature = signature;
    onContext(context);
  };

  const emitPlaybackUpdate = (
    onPlaybackUpdate: (update: PlaybackUpdate) => void,
  ): void => {
    if (Date.now() < suppressLocalCommandsUntil) {
      return;
    }

    const context = getContext();
    if (!context.playbackReady || !context.mediaId) {
      return;
    }

    onPlaybackUpdate({
      serviceId: 'netflix',
      mediaId: context.mediaId,
      title: context.mediaTitle,
      positionSec: context.positionSec,
      playing: context.playing,
      issuedAt: Date.now(),
    });
  };

  const bindVideoEvents = (
    video: HTMLVideoElement,
    onContext: (context: ServiceContentContext) => void,
    onPlaybackUpdate: (update: PlaybackUpdate) => void,
  ): void => {
    if (activeVideo === video) {
      return;
    }

    activeVideo?.removeEventListener('play', onPlay);
    activeVideo?.removeEventListener('pause', onPause);
    activeVideo?.removeEventListener('seeked', onSeeked);

    activeVideo = video;
    activeVideo.addEventListener('play', onPlay);
    activeVideo.addEventListener('pause', onPause);
    activeVideo.addEventListener('seeked', onSeeked);
    emitContextIfChanged(onContext);
  };

  const observe = (
    onContext: (context: ServiceContentContext) => void,
    onPlaybackUpdate: (update: PlaybackUpdate) => void,
  ): (() => void) => {
    notifyContext = onContext;
    notifyPlaybackUpdate = onPlaybackUpdate;

    const mutationObserver = new MutationObserver(() => {
      const video = getVideo();
      if (video) {
        bindVideoEvents(video, onContext, onPlaybackUpdate);
      } else {
        activeVideo?.removeEventListener('play', onPlay);
        activeVideo?.removeEventListener('pause', onPause);
        activeVideo?.removeEventListener('seeked', onSeeked);
        activeVideo = null;
      }

      emitContextIfChanged(onContext);
    });

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const intervalId = window.setInterval(() => {
      const video = getVideo();
      if (video) {
        bindVideoEvents(video, onContext, onPlaybackUpdate);
      }

      emitContextIfChanged(onContext);
    }, 1_000);

    const firstVideo = getVideo();
    if (firstVideo) {
      bindVideoEvents(firstVideo, onContext, onPlaybackUpdate);
    }
    emitContextIfChanged(onContext);

    return () => {
      mutationObserver.disconnect();
      window.clearInterval(intervalId);
      activeVideo?.removeEventListener('play', onPlay);
      activeVideo?.removeEventListener('pause', onPause);
      activeVideo?.removeEventListener('seeked', onSeeked);
      activeVideo = null;
      notifyContext = null;
      notifyPlaybackUpdate = null;
    };
  };

  const applySnapshot = async (
    snapshot: PartySnapshot,
  ): Promise<ApplySnapshotResult> => {
    const context = getContext();
    const video = getVideo();

    if (!snapshot.playback) {
      return { applied: false, reason: 'No playback state available yet.', context };
    }

    if (!video || !context.playbackReady) {
      return { applied: false, reason: 'Netflix player is not ready.', context };
    }

    if (context.mediaId && snapshot.playback.mediaId !== context.mediaId) {
      return {
        applied: false,
        reason: 'Current Netflix title does not match the room playback.',
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
          context: getContext(),
        };
      }
    }

    if (!snapshot.playback.playing && !video.paused) {
      video.pause();
    }

    return { applied: true, context: getContext() };
  };

  return {
    serviceId: 'netflix',
    getContext,
    applySnapshot,
    observe,
  };
}
