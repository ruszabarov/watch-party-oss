import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
  type NetflixPlayerStatusResponse,
} from './player-rpc';
import type { NetflixPlayer } from './window';

function getNetflixPlayer(): NetflixPlayer | null {
  const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
  const sessionId = videoPlayer?.getAllPlayerSessionIds?.()[0];
  return sessionId ? (videoPlayer?.getVideoPlayerBySessionId(sessionId) ?? null) : null;
}

function applyCommand(command: NetflixPlayerCommand): void {
  try {
    const player = getNetflixPlayer();
    if (!player) return;

    if (command.positionMs !== undefined) {
      player.seek(command.positionMs);
    }

    if (command.playing) {
      player.play();
    } else {
      player.pause();
    }
  } catch {
    // Netflix player API rejected the command; nothing we can do here.
  }
}

export function runNetflixPlayerContentScript(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) {
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
          hasPlayer: getNetflixPlayer() !== null,
        } satisfies NetflixPlayerStatusResponse,
        '*',
      );
    }
  });
}
