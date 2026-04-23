import { describe, expect, it } from 'vitest';

import { createTokenBucketRateLimiter } from './token-bucket-rate-limiter';

describe('token bucket rate limiter', () => {
  it('rejects requests after consuming the available burst capacity', () => {
    const limiter = createTokenBucketRateLimiter({
      capacity: 3,
      refillRatePerSecond: 1,
      now: () => 1_000,
    });

    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);
  });

  it('refills tokens over time', () => {
    let currentTime = 1_000;
    const limiter = createTokenBucketRateLimiter({
      capacity: 2,
      refillRatePerSecond: 4,
      now: () => currentTime,
    });

    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);

    currentTime += 250;
    expect(limiter.consume('socket-1')).toBe(true);
  });

  it('resets per-key state', () => {
    const limiter = createTokenBucketRateLimiter({
      capacity: 1,
      refillRatePerSecond: 1,
      now: () => 1_000,
    });

    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);

    limiter.reset('socket-1');

    expect(limiter.consume('socket-1')).toBe(true);
  });
});
