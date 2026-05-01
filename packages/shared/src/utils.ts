const SAFE_MEDIA_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isSafeMediaId(mediaId: string): boolean {
  return SAFE_MEDIA_ID_RE.test(mediaId);
}
