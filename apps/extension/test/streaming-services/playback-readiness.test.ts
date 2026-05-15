import { describe, expect, it } from 'vitest';

import { isVideoTimelineReady } from '../../src/streaming-services/playback-readiness';

function videoCandidate(readyState: number, currentTime: number): HTMLMediaElement {
  return { currentTime, readyState } as HTMLMediaElement;
}

describe('isVideoTimelineReady', () => {
  it('does not treat a missing video as ready', () => {
    expect(isVideoTimelineReady(null)).toBe(false);
  });

  it('does not treat a video without metadata as ready', () => {
    expect(isVideoTimelineReady(videoCandidate(0, 12))).toBe(false);
  });

  it('does not treat a video with a non-finite timeline as ready', () => {
    expect(isVideoTimelineReady(videoCandidate(1, Number.NaN))).toBe(false);
  });

  it('treats a video with metadata and a finite current time as ready', () => {
    expect(isVideoTimelineReady(videoCandidate(1, 12))).toBe(true);
  });
});
