import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixPlayerResponse,
  type NetflixRpcRequest,
  type NetflixRpcResponse,
} from '../services/netflix-player-rpc';
import type { NetflixPlayer } from '../types/netflix';

function getNetflixPlayer(): NetflixPlayer | null {
  const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
  const sessionId = videoPlayer?.getAllPlayerSessionIds?.()[0];
  return sessionId ? (videoPlayer?.getVideoPlayerBySessionId(sessionId) ?? null) : null;
}

function applyCommand(command: NetflixPlayerCommand): NetflixPlayerResponse {
  try {
    const player = getNetflixPlayer();
    if (!player) {
      return {
        applied: false,
        reason: 'Netflix player API is not ready yet.',
      };
    }

    if (command.positionMs !== undefined) {
      player.seek(command.positionMs);
    }

    if (command.playing) {
      player.play();
    } else {
      player.pause();
    }

    return { applied: true };
  } catch {
    return {
      applied: false,
      reason: 'Netflix player API rejected the sync command.',
    };
  }
}

export default defineContentScript({
  matches: ['*://*.netflix.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) {
        return;
      }

      const data = event.data as Partial<NetflixRpcRequest> | null;
      if (data?.source !== NETFLIX_PLAYER_REQUEST_SOURCE || !data.id || !data.command) {
        return;
      }

      window.postMessage(
        {
          source: NETFLIX_PLAYER_RESPONSE_SOURCE,
          id: data.id,
          response: applyCommand(data.command),
        } satisfies NetflixRpcResponse,
        '*',
      );
    });
  },
});
