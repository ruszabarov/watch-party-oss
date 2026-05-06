import type { ServiceDefinition } from '../services';
import { isSafeMediaId } from '../utils';

const NETFLIX_HOST_RE = /(^|\.)netflix\.com$/;

function extractNetflixMediaId(url: URL): string | null {
  return url.pathname.match(/^\/watch\/(\d+)/)?.[1] ?? null;
}

export const NETFLIX_DEFINITION = {
  descriptor: {
    label: 'Netflix',
    accent: '#e50914',
    accentContrast: '#ffffff',
    glyph: 'N',
  },
  contentMatches: ['*://*.netflix.com/*'],
  matchesUrl: (url: URL) => NETFLIX_HOST_RE.test(url.hostname),
  extractMediaId: extractNetflixMediaId,
  isMediaIdValid: (mediaId: string) => isSafeMediaId(mediaId) && /^[0-9]+$/.test(mediaId),
  buildCanonicalWatchUrl: (mediaId: string) => `https://www.netflix.com/watch/${mediaId}`,
} satisfies ServiceDefinition;
