import { TokenBucket } from 'limiter';

const PLAYBACK_UPDATE_TOKENS_PER_SECOND = 10;
const PLAYBACK_UPDATE_BURST_CAPACITY = 20;

export function createPlaybackUpdateTokenConsumer(): () => boolean {
  const bucket = new TokenBucket({
    bucketSize: PLAYBACK_UPDATE_BURST_CAPACITY,
    tokensPerInterval: PLAYBACK_UPDATE_TOKENS_PER_SECOND,
    interval: 'second',
  });

  // TokenBucket starts empty; pre-fill so a fresh session has its full burst
  // available immediately. Mirrors how limiter's own RateLimiter initializes
  // its underlying bucket (see limiter/src/RateLimiter.ts).
  bucket.content = PLAYBACK_UPDATE_BURST_CAPACITY;

  return () => bucket.tryRemoveTokens(1);
}
