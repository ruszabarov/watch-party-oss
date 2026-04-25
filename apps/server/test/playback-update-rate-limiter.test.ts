import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlaybackUpdateTokenConsumer } from '../src/rate-limiter';

afterEach(() => {
  vi.useRealTimers();
});

describe('createPlaybackUpdateTokenConsumer', () => {
  it('starts with the full burst capacity available immediately', () => {
    const allow = createPlaybackUpdateTokenConsumer();

    for (let index = 0; index < 20; index += 1) {
      expect(allow()).toBe(true);
    }
    expect(allow()).toBe(false);
  });

  it('isolates buckets between consumer instances', () => {
    const allowA = createPlaybackUpdateTokenConsumer();
    const allowB = createPlaybackUpdateTokenConsumer();

    for (let index = 0; index < 20; index += 1) {
      expect(allowA()).toBe(true);
    }
    expect(allowA()).toBe(false);
    expect(allowB()).toBe(true);
  });

  it('refills tokens over time at the configured rate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:00:00.000Z'));

    const allow = createPlaybackUpdateTokenConsumer();

    for (let index = 0; index < 20; index += 1) {
      expect(allow()).toBe(true);
    }
    expect(allow()).toBe(false);

    vi.advanceTimersByTime(100);
    expect(allow()).toBe(true);
    expect(allow()).toBe(false);
  });
});
