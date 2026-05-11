import { STREAMING_SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { PlaybackStatus, StreamingServiceIntegration } from './types';

const YOUTUBE_TITLE_SUFFIX = /\s*-\s*YouTube$/i;
const YOUTUBE_STREAMING_SERVICE_DEFINITION = STREAMING_SERVICE_DEFINITION_BY_ID.youtube;
const YOUTUBE_AD_REASON = 'YouTube is showing an ad. Sync will resume when the video returns.';
const YOUTUBE_AD_CLASS_NAMES = new Set(['ad-showing', 'ad-interrupting']);

export function isYoutubeAdPlayback(playerClassName: string | null | undefined): boolean {
  return (playerClassName ?? '')
    .split(/\s+/)
    .some((className) => YOUTUBE_AD_CLASS_NAMES.has(className));
}

function getYoutubePlayer(video: HTMLVideoElement): Element | null {
  return video.closest('#movie_player') ?? document.querySelector('#movie_player');
}

function getYoutubePlaybackStatus(video: HTMLVideoElement): PlaybackStatus {
  const player = getYoutubePlayer(video);
  const playerClassName =
    player instanceof HTMLElement ? player.className : (player?.getAttribute('class') ?? '');

  if (isYoutubeAdPlayback(playerClassName)) {
    return { syncable: false, reason: YOUTUBE_AD_REASON };
  }

  return { syncable: true };
}

export const YOUTUBE_STREAMING_SERVICE: StreamingServiceIntegration = {
  ...YOUTUBE_STREAMING_SERVICE_DEFINITION,
  playerNotReadyMessage: 'YouTube player is still loading.',
  getVideo: () =>
    document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video, video'),
  getMediaTitle: () => document.title.replace(YOUTUBE_TITLE_SUFFIX, '').trim(),
  getPlaybackStatus: getYoutubePlaybackStatus,
  getPlaybackStatusTarget: getYoutubePlayer,
};
