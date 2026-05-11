import { SERVICE_DEFINITION_BY_ID } from '@open-watch-party/shared';
import type { ApplySnapshotResult } from '../messaging';
import { applyNetflixPlayerSnapshot } from './netflix-player-bridge';
import type { PlaybackApplyContext, ServicePlugin } from './types';

const NETFLIX_TITLE_SUFFIX = /\s*-\s*Netflix$/i;
const NETFLIX_DEFINITION = SERVICE_DEFINITION_BY_ID.netflix;
const NETFLIX_SEEK_THRESHOLD_SEC = 5;

function applyNetflixPlayerPlayback(playing: boolean, positionSec?: number) {
  return applyNetflixPlayerSnapshot({
    ...(positionSec === undefined ? {} : { positionMs: Math.round(positionSec * 1000) }),
    playing,
  });
}

async function applyNetflixPlayback({
  video,
  snapshot,
}: PlaybackApplyContext): Promise<ApplySnapshotResult> {
  const { positionSec, playing } = snapshot.playback;
  const driftSec = Math.abs(video.currentTime - positionSec);

  if (driftSec > NETFLIX_SEEK_THRESHOLD_SEC) {
    return applyNetflixPlayerPlayback(playing, positionSec);
  }

  return applyNetflixPlayerPlayback(playing);
}

export const NETFLIX_SERVICE: ServicePlugin = {
  ...NETFLIX_DEFINITION,
  playerNotReadyMessage: 'Netflix player is still loading.',
  getVideo: () => document.querySelector<HTMLVideoElement>('video'),
  getMediaTitle: () => document.title.replace(NETFLIX_TITLE_SUFFIX, '').trim() || 'Netflix',
  applyPlayback: applyNetflixPlayback,
};
