import type { ServiceDefinition } from '../services';
import { isSafeMediaId } from '../utils';

const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/;

function extractYoutubeMediaId(url: URL): string | null {
  const host = url.hostname;

  if (/(^|\.)youtube\.com$/.test(host)) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v')?.trim();
      return id || null;
    }
    return url.pathname.match(/^\/(?:embed|live)\/([^/?#]+)/)?.[1] ?? null;
  }

  if (/(^|\.)youtube-nocookie\.com$/.test(host)) {
    return url.pathname.match(/^\/embed\/([^/?#]+)/)?.[1] ?? null;
  }

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0];
    return id || null;
  }

  return null;
}

export const YOUTUBE_DEFINITION = {
  descriptor: {
    label: 'YouTube',
    accent: '#ff0033',
    accentContrast: '#ffffff',
    glyph: 'Y',
  },
  contentMatches: ['*://*.youtube.com/*', '*://youtu.be/*', '*://*.youtube-nocookie.com/*'],
  matchesUrl: (url: URL) => YOUTUBE_HOST_RE.test(url.hostname),
  extractMediaId: extractYoutubeMediaId,
  isMediaIdValid: isSafeMediaId,
  buildCanonicalWatchUrl: (mediaId: string) => `https://www.youtube.com/watch?v=${mediaId}`,
} satisfies ServiceDefinition;
