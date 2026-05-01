import { SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { ServicePlugin } from './types';

const YOUTUBE_TITLE_SUFFIX = /\s*-\s*YouTube$/i;
const YOUTUBE_DEFINITION = SERVICE_DEFINITION_BY_ID.youtube;

export const YOUTUBE_SERVICE: ServicePlugin = {
  ...YOUTUBE_DEFINITION,
  playerNotReadyMessage: 'YouTube player is still loading.',
  getVideo: () =>
    document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video, video'),
  getMediaTitle: () => document.title.replace(YOUTUBE_TITLE_SUFFIX, '').trim(),
};
