import { createDomVideoAdapter } from './dom-video';
import type { ServicePlugin } from './types';

const YOUTUBE_HOST_RE =
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/;
const YOUTUBE_TITLE_SUFFIX = /\s*-\s*YouTube$/i;

function parseYoutube(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return YOUTUBE_HOST_RE.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function extractYoutubeMediaId(url: URL): string | undefined {
  const host = url.hostname;

  if (/(^|\.)youtube\.com$/.test(host)) {
    if (url.pathname === '/watch') {
      return url.searchParams.get('v') ?? undefined;
    }
    return (
      url.pathname.match(/^\/(?:embed|live)\/([^/?#]+)/)?.[1] ?? undefined
    );
  }

  if (/(^|\.)youtube-nocookie\.com$/.test(host)) {
    return url.pathname.match(/^\/embed\/([^/?#]+)/)?.[1] ?? undefined;
  }

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0];
    return id || undefined;
  }

  return undefined;
}

export const YOUTUBE_SERVICE: ServicePlugin = {
  descriptor: {
    id: 'youtube',
    label: 'YouTube',
    accent: '#ff0033',
    accentContrast: '#ffffff',
    glyph: 'Y',
    watchPathHint: 'youtube.com/watch?v=…',
  },
  contentMatches: [
    '*://*.youtube.com/*',
    '*://youtu.be/*',
    '*://*.youtube-nocookie.com/*',
  ],
  matchesService: (url) => parseYoutube(url) !== null,
  matchesWatchPage: (url) => {
    const parsed = parseYoutube(url);
    return parsed ? extractYoutubeMediaId(parsed) !== undefined : false;
  },
  createAdapter: () =>
    createDomVideoAdapter({
      serviceId: 'youtube',
      // YouTube keeps a hidden miniplayer <video> around; prefer the main
      // movie container before falling back to any <video>.
      videoSelector: '#movie_player video, video.html5-main-video, video',
      matchMediaId: (loc) => extractYoutubeMediaId(new URL(loc.href)),
      matchMediaTitle: (doc) =>
        doc.title.replace(YOUTUBE_TITLE_SUFFIX, '').trim(),
      issueWhenNoMedia: 'Open a youtube.com/watch?v=… page to start a party.',
      issueWhenPlayerNotReady: 'YouTube player is still loading.',
    }),
};
