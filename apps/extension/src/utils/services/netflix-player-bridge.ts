import type { ApplySnapshotResult } from '../protocol/extension';
import {
  NETFLIX_PLAYER_REQUEST_SOURCE,
  NETFLIX_PLAYER_RESPONSE_SOURCE,
  type NetflixPlayerCommand,
  type NetflixRpcRequest,
  type NetflixRpcResponse,
} from './netflix-player-rpc';

const NETFLIX_PLAYER_RESPONSE_TIMEOUT_MS = 1500;

export function applyNetflixPlayerSnapshot(
  command: NetflixPlayerCommand,
): Promise<ApplySnapshotResult> {
  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      resolve({ applied: false, reason: 'Netflix player API is not ready yet.' });
    }, NETFLIX_PLAYER_RESPONSE_TIMEOUT_MS);

    function handleResponse(event: MessageEvent) {
      if (event.source !== window) {
        return;
      }

      const data = event.data as Partial<NetflixRpcResponse> | null;
      if (data?.source !== NETFLIX_PLAYER_RESPONSE_SOURCE || data.id !== id || !data.response) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);
      resolve(data.response);
    }

    window.addEventListener('message', handleResponse);
    window.postMessage(
      {
        source: NETFLIX_PLAYER_REQUEST_SOURCE,
        id,
        command,
      } satisfies NetflixRpcRequest,
      '*',
    );
  });
}
