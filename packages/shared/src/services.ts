import type { ServiceId } from './protocol';

const SAFE_MEDIA_ID_RE = /^[A-Za-z0-9_-]+$/;

function isSafeMediaId(mediaId: string): boolean {
  return mediaId.length > 0 && SAFE_MEDIA_ID_RE.test(mediaId);
}

export function buildCanonicalWatchUrl(
  serviceId: ServiceId,
  mediaId: string,
): string | null {
  if (!isSafeMediaId(mediaId)) {
    return null;
  }

  switch (serviceId) {
    case 'netflix':
      return /^[0-9]+$/.test(mediaId)
        ? `https://www.netflix.com/watch/${mediaId}`
        : null;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${mediaId}`;
    default:
      return null;
  }
}
