import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
  type NetflixPlayerStatusResponse,
} from './player-rpc';
import type { NetflixPlayer } from './window';

function getNetflixPlayer(): NetflixPlayer | null {
  try {
    const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
    const sessionId = videoPlayer?.getAllPlayerSessionIds?.()[0];
    return sessionId ? (videoPlayer?.getVideoPlayerBySessionId(sessionId) ?? null) : null;
  } catch {
    return null;
  }
}

function getVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video');
}

function applyViaApi(command: NetflixPlayerCommand): boolean {
  try {
    const player = getNetflixPlayer();
    if (!player) return false;

    if (command.positionMs !== undefined) {
      player.seek(command.positionMs);
    }

    if (command.playing) {
      player.play();
    } else {
      player.pause();
    }

    return true;
  } catch {
    return false;
  }
}

function applyViaVideoElement(command: NetflixPlayerCommand): void {
  const video = getVideo();
  if (!video) return;

  if (command.playing && video.paused) {
    void video.play().catch(() => {});
  } else if (!command.playing && !video.paused) {
    video.pause();
  }
}

function applyCommand(command: NetflixPlayerCommand): void {
  if (applyViaApi(command)) return;

  applyViaVideoElement(command);
}

export function runNetflixPlayerContentScript(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.origin) {
      return;
    }

    const data = event.data as Partial<NetflixRpcRequest> | null;
    if (data?.source !== NETFLIX_PLAYER_REQUEST_SOURCE) {
      return;
    }

    if ('command' in data && data.command) {
      applyCommand(data.command);
      return;
    }

    if ('query' in data && data.query === 'status' && typeof data.requestId === 'string') {
      window.postMessage(
        {
          source: NETFLIX_PLAYER_RESPONSE_SOURCE,
          requestId: data.requestId,
          hasPlayer: getNetflixPlayer() !== null || getVideo() !== null,
        } satisfies NetflixPlayerStatusResponse,
        '*',
      );
    }
  });
}
