import { createDomVideoAdapter } from './dom-video';
import type { ServicePlugin } from './types';

const NETFLIX_HOST_RE = /(^|\.)netflix\.com$/;
const NETFLIX_TITLE_SUFFIX = /\s*-\s*Netflix$/i;

function parseNetflix(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return NETFLIX_HOST_RE.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function extractNetflixMediaId(url: URL): string | undefined {
  return url.pathname.match(/^\/watch\/(\d+)/)?.[1];
}

export const NETFLIX_SERVICE: ServicePlugin = {
  descriptor: {
    id: 'netflix',
    label: 'Netflix',
    accent: '#e50914',
    accentContrast: '#ffffff',
    glyph: 'N',
    watchPathHint: 'netflix.com/watch/…',
  },
  contentMatches: ['*://*.netflix.com/*'],
  matchesService: (url) => parseNetflix(url) !== null,
  matchesWatchPage: (url) => {
    const parsed = parseNetflix(url);
    return parsed ? extractNetflixMediaId(parsed) !== undefined : false;
  },
  createAdapter: () =>
    createDomVideoAdapter({
      serviceId: 'netflix',
      matchMediaId: (loc) => extractNetflixMediaId(new URL(loc.href)),
      matchMediaTitle: (doc) =>
        doc.title.replace(NETFLIX_TITLE_SUFFIX, '').trim() || 'Netflix',
      issueWhenNoMedia: 'Open a Netflix watch page to start a party.',
      issueWhenPlayerNotReady: 'Netflix player is still loading.',
    }),
};
