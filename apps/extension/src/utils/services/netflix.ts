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
  id: 'netflix',
  descriptor: {
    id: 'netflix',
    label: 'Netflix',
    accent: '#e50914',
    accentContrast: '#ffffff',
    glyph: 'N',
    watchPathHint: 'netflix.com/watch/…',
  },
  contentMatches: ['*://*.netflix.com/*'],
  playerNotReadyMessage: 'Netflix player is still loading.',
  parseUrl: (url) => {
    const parsed = parseNetflix(url);
    return parsed ? { mediaId: extractNetflixMediaId(parsed) } : null;
  },
  getVideo: () => document.querySelector<HTMLVideoElement>('video'),
  getMediaTitle: () => document.title.replace(NETFLIX_TITLE_SUFFIX, '').trim() || 'Netflix',
};
