import { SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { ServicePlugin } from './types';

const NETFLIX_TITLE_SUFFIX = /\s*-\s*Netflix$/i;
const NETFLIX_DEFINITION = SERVICE_DEFINITION_BY_ID.netflix;

export const NETFLIX_SERVICE: ServicePlugin = {
  ...NETFLIX_DEFINITION,
  playerNotReadyMessage: 'Netflix player is still loading.',
  getVideo: () => document.querySelector<HTMLVideoElement>('video'),
  getMediaTitle: () => document.title.replace(NETFLIX_TITLE_SUFFIX, '').trim() || 'Netflix',
};
