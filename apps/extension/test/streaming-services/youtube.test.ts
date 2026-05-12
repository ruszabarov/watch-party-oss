import { describe, expect, it } from 'vitest';

import { isYoutubeAdPlayback } from '../../src/streaming-services/youtube/ads';

describe('isYoutubeAdPlayback', () => {
  it('treats normal YouTube player state as syncable content playback', () => {
    expect(isYoutubeAdPlayback('html5-video-player ytp-transparent')).toBe(false);
  });

  it('detects ad-showing player state', () => {
    expect(isYoutubeAdPlayback('html5-video-player ad-showing ytp-autohide')).toBe(true);
  });

  it('detects ad-interrupting player state', () => {
    expect(isYoutubeAdPlayback('html5-video-player ad-interrupting')).toBe(true);
  });

  it('matches ad states as class names instead of substrings', () => {
    expect(isYoutubeAdPlayback('html5-video-player not-ad-showing')).toBe(false);
  });
});
