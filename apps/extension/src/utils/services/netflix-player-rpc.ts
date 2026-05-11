import type { ApplySnapshotResult } from '../protocol/extension';

export const NETFLIX_PLAYER_REQUEST_SOURCE = 'open-watch-party:netflix-player-request';
export const NETFLIX_PLAYER_RESPONSE_SOURCE = 'open-watch-party:netflix-player-response';

export type NetflixPlayerCommand = {
  positionMs?: number;
  playing: boolean;
};

export type NetflixPlayerResponse = ApplySnapshotResult;

export type NetflixRpcRequest = {
  source: typeof NETFLIX_PLAYER_REQUEST_SOURCE;
  id: string;
  command: NetflixPlayerCommand;
};

export type NetflixRpcResponse = {
  source: typeof NETFLIX_PLAYER_RESPONSE_SOURCE;
  id: string;
  response: NetflixPlayerResponse;
};
