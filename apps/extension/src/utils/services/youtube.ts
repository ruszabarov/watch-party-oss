import type { ServicePlugin } from './types';

const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/;
const YOUTUBE_TITLE_SUFFIX = /\s*-\s*YouTube$/i;

interface YouTubePlayerApi {
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
}

type YouTubePlayerElement = HTMLElement & YouTubePlayerApi;

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
    return url.pathname.match(/^\/(?:embed|live)\/([^/?#]+)/)?.[1] ?? undefined;
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

function isYouTubePlayerElement(value: Element | null): value is YouTubePlayerElement {
  const seekTo = value ? Reflect.get(value, 'seekTo') : undefined;
  const playVideo = value ? Reflect.get(value, 'playVideo') : undefined;
  const pauseVideo = value ? Reflect.get(value, 'pauseVideo') : undefined;

  if (
    !value ||
    !(value instanceof HTMLElement) ||
    typeof seekTo !== 'function' ||
    typeof playVideo !== 'function' ||
    typeof pauseVideo !== 'function'
  ) {
    return false;
  }

  return true;
}

function getYoutubePlayerApi(): YouTubePlayerElement | null {
  const player = document.getElementById('movie_player');
  return isYouTubePlayerElement(player) ? player : null;
}

export const YOUTUBE_SERVICE: ServicePlugin = {
  id: 'youtube',
  descriptor: {
    id: 'youtube',
    label: 'YouTube',
    accent: '#ff0033',
    accentContrast: '#ffffff',
    glyph: 'Y',
    watchPathHint: 'youtube.com/watch?v=…',
  },
  contentMatches: ['*://*.youtube.com/*', '*://youtu.be/*', '*://*.youtube-nocookie.com/*'],
  issues: {
    noMedia: 'Open a youtube.com/watch?v=... page to start a party.',
    playerNotReady: 'YouTube player is still loading.',
  },
  parseUrl: (url) => {
    const parsed = parseYoutube(url);
    return parsed ? { mediaId: extractYoutubeMediaId(parsed) } : null;
  },
  getVideo: () =>
    document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video, video'),
  getMediaTitle: () => document.title.replace(YOUTUBE_TITLE_SUFFIX, '').trim(),
  getStructureRoot: () => document.querySelector('#movie_player'),
  apply: (_video, target) => {
    const player = getYoutubePlayerApi();
    if (!player) {
      return Promise.resolve({
        ok: false,
        reason: 'YouTube player is still loading.',
      });
    }

    player.seekTo(target.positionSec, true);
    if (target.playing) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }

    return Promise.resolve({ ok: true });
  },
};
