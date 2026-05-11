export type NetflixPlayer = {
  seek(positionMs: number): void;
  play(): void;
  pause(): void;
};

export type NetflixVideoPlayerApi = {
  getAllPlayerSessionIds(): string[];
  getVideoPlayerBySessionId(sessionId: string): NetflixPlayer | null | undefined;
};

declare global {
  interface Window {
    netflix?: {
      appContext?: {
        state?: {
          playerApp?: {
            getAPI?(): {
              videoPlayer?: NetflixVideoPlayerApi;
            };
          };
        };
      };
    };
  }
}
