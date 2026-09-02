export const OPEN_API_RATE_LIMIT = { capacity: 20, refillPerSecond: 2 } as const;

/** 无效 bearer 探测按来源 IP 限流：20 次/分钟。 */
export const OPEN_API_FAILED_AUTH_RATE_LIMIT = {
  capacity: 20,
  refillPerSecond: 20 / 60,
} as const;

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

const SWEEP_INTERVAL_OPS = 128;

export class ApiRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private opsSinceSweep = 0;

  constructor(options: Options) {
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitDecision {
    const nowMs = this.now();
    this.tick(nowMs);
    const bucket = this.buckets.get(key);
    const tokens = bucket === undefined ? this.capacity : this.refilledTokens(bucket, nowMs);
    if (tokens >= 1) {
      this.buckets.set(key, { tokens: tokens - 1, updatedAtMs: nowMs });
      return { allowed: true };
    }
    this.buckets.set(key, { tokens, updatedAtMs: nowMs });
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / this.refillPerMs / 1000) };
  }

  /** 回补 consume 预扣的一枚 token：净效果仅认证失败耗桶；回补不超过 capacity。 */
  refund(key: string): void {
    const nowMs = this.now();
    this.tick(nowMs);
    const bucket = this.buckets.get(key);
    if (bucket === undefined) {
      return;
    }
    const tokens = this.refilledTokens(bucket, nowMs) + 1;
    if (tokens >= this.capacity) {
      this.buckets.delete(key);
    } else {
      this.buckets.set(key, { tokens, updatedAtMs: nowMs });
    }
  }

  private refilledTokens(bucket: Bucket, nowMs: number): number {
    return Math.min(this.capacity, bucket.tokens + (nowMs - bucket.updatedAtMs) * this.refillPerMs);
  }

  private tick(nowMs: number): void {
    this.opsSinceSweep += 1;
    if (this.opsSinceSweep >= SWEEP_INTERVAL_OPS) {
      this.opsSinceSweep = 0;
      this.sweep(nowMs);
    }
  }

  // 回满血的桶与条目缺席等价：定期清掉，buckets 不随唯一 key（IP/keyId）数无界增长。
  private sweep(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (this.refilledTokens(bucket, nowMs) >= this.capacity) {
        this.buckets.delete(key);
      }
    }
  }
}

export const FAILED_AUTH_ATTEMPT_TTL_MS = 10 * 60_000;

interface AttemptEntry {
  count: number;
  updatedAtMs: number;
}

/** 失败认证计数（仅日志观测，不作执法）：TTL 懒重置 + 定期淘汰，Map 不无界增长。 */
export class FailedAuthAttempts {
  private readonly entries = new Map<string, AttemptEntry>();
  private readonly now: () => number;
  private opsSinceSweep = 0;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  bump(key: string): number {
    const nowMs = this.now();
    this.tick(nowMs);
    const prev = this.entries.get(key);
    const count =
      prev !== undefined && nowMs - prev.updatedAtMs <= FAILED_AUTH_ATTEMPT_TTL_MS
        ? prev.count + 1
        : 1;
    this.entries.set(key, { count, updatedAtMs: nowMs });
    return count;
  }

  peek(key: string): number {
    const prev = this.entries.get(key);
    if (prev === undefined || this.now() - prev.updatedAtMs > FAILED_AUTH_ATTEMPT_TTL_MS) {
      return 0;
    }
    return prev.count;
  }

  private tick(nowMs: number): void {
    this.opsSinceSweep += 1;
    if (this.opsSinceSweep >= SWEEP_INTERVAL_OPS) {
      this.opsSinceSweep = 0;
      for (const [key, entry] of this.entries) {
        if (nowMs - entry.updatedAtMs > FAILED_AUTH_ATTEMPT_TTL_MS) {
          this.entries.delete(key);
        }
      }
    }
  }
}
