export const NETFLIX_PLAYER_REQUEST_SOURCE = 'open-watch-party:netflix-player-request';

export type NetflixPlayerCommand = {
  positionMs?: number;
  playing: boolean;
};

export type NetflixRpcRequest = {
  source: typeof NETFLIX_PLAYER_REQUEST_SOURCE;
  command: NetflixPlayerCommand;
};
