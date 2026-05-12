const YOUTUBE_AD_CLASS_NAMES = new Set(['ad-showing', 'ad-interrupting']);

export function isYoutubeAdPlayback(playerClassName: string | null | undefined): boolean {
  return (playerClassName ?? '')
    .split(/\s+/)
    .some((className) => YOUTUBE_AD_CLASS_NAMES.has(className));
}
