type TokenBucket = {
  tokens: number;
  lastRefillAt: number;
};

export type TokenBucketRateLimiter = {
  consume(key: string): boolean;
  reset(key: string): void;
};

export type TokenBucketRateLimiterOptions = {
  capacity: number;
  refillRatePerSecond: number;
  now?: () => number;
};

export function createTokenBucketRateLimiter(
  options: TokenBucketRateLimiterOptions,
): TokenBucketRateLimiter {
  const buckets = new Map<string, TokenBucket>();
  const now = options.now ?? Date.now;

  return {
    consume(key: string): boolean {
      const currentTime = now();
      const bucket = buckets.get(key) ?? {
        tokens: options.capacity,
        lastRefillAt: currentTime,
      };

      const availableTokens = refillBucket(bucket, options, currentTime);
      if (availableTokens < 1) {
        buckets.set(key, {
          tokens: availableTokens,
          lastRefillAt: currentTime,
        });
        return false;
      }

      buckets.set(key, {
        tokens: availableTokens - 1,
        lastRefillAt: currentTime,
      });
      return true;
    },

    reset(key: string): void {
      buckets.delete(key);
    },
  };
}

function refillBucket(
  bucket: TokenBucket,
  options: TokenBucketRateLimiterOptions,
  now: number,
): number {
  const elapsedMs = Math.max(0, now - bucket.lastRefillAt);
  const replenished =
    bucket.tokens + (elapsedMs / 1_000) * options.refillRatePerSecond;
  return Math.min(options.capacity, replenished);
}
