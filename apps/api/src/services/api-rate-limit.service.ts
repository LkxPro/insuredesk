export const OPEN_API_RATE_LIMIT = { capacity: 20, refillPerSecond: 2 } as const;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

interface Options {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}

export class ApiRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(options: Options) {
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitDecision {
    const nowMs = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAtMs: nowMs };
    const tokens = Math.min(
      this.capacity,
      bucket.tokens + (nowMs - bucket.updatedAtMs) * this.refillPerMs,
    );
    if (tokens >= 1) {
      this.buckets.set(key, { tokens: tokens - 1, updatedAtMs: nowMs });
      return { allowed: true };
    }
    this.buckets.set(key, { tokens, updatedAtMs: nowMs });
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / this.refillPerMs / 1000) };
  }
}
