export const NETFLIX_PLAYER_REQUEST_SOURCE = 'open-watch-party:netflix-player-request';
export const NETFLIX_PLAYER_RESPONSE_SOURCE = 'open-watch-party:netflix-player-response';

export type NetflixPlayerCommand = {
  positionMs?: number;
  playing: boolean;
};

export type NetflixPlayerCommandRequest = {
  source: typeof NETFLIX_PLAYER_REQUEST_SOURCE;
  command: NetflixPlayerCommand;
};

export type NetflixPlayerStatusRequest = {
  source: typeof NETFLIX_PLAYER_REQUEST_SOURCE;
  requestId: string;
  query: 'status';
};

export type NetflixRpcRequest = NetflixPlayerCommandRequest | NetflixPlayerStatusRequest;

export type NetflixPlayerStatusResponse = {
  source: typeof NETFLIX_PLAYER_RESPONSE_SOURCE;
  requestId: string;
  hasPlayer: boolean;
};
