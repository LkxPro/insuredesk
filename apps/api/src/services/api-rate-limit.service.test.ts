import { describe, expect, it } from "vitest";
import {
  ApiRateLimiter,
  FAILED_AUTH_ATTEMPT_TTL_MS,
  FailedAuthAttempts,
} from "./api-rate-limit.service.ts";

function makeLimiter() {
  let nowMs = 0;
  const limiter = new ApiRateLimiter({ capacity: 20, refillPerSecond: 2, now: () => nowMs });
  return { limiter, advance: (ms: number) => (nowMs += ms) };
}

describe("ApiRateLimiter token bucket", () => {
  it("burst 20 内全放行，第 21 次拒绝并给 Retry-After", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.consume("k1").allowed).toBe(true);
    }
    const denied = limiter.consume("k1");
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("按 120 次/分（2/秒）回补：0.5 秒补 1 个", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 20; i += 1) {
      limiter.consume("k1");
    }
    expect(limiter.consume("k1").allowed).toBe(false);

    advance(499);
    expect(limiter.consume("k1").allowed).toBe(false);

    advance(1);
    expect(limiter.consume("k1").allowed).toBe(true);
    expect(limiter.consume("k1").allowed).toBe(false);
  });

  it("拒绝不预支未来 token：连续被拒后 Retry-After 不滚雪球", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 20; i += 1) {
      limiter.consume("k1");
    }
    expect(limiter.consume("k1")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.consume("k1")).toEqual({ allowed: false, retryAfterSeconds: 1 });

    advance(500);
    expect(limiter.consume("k1").allowed).toBe(true);
  });

  it("桶按 key 隔离；闲置后回补到 capacity 封顶", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 20; i += 1) {
      limiter.consume("k1");
    }
    expect(limiter.consume("k2").allowed).toBe(true);

    advance(60_000);
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.consume("k1").allowed).toBe(true);
    }
    expect(limiter.consume("k1").allowed).toBe(false);
  });

  it("refund 回补一枚：耗尽的桶 refund 后再放行一次", () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 20; i += 1) {
      limiter.consume("k1");
    }
    expect(limiter.consume("k1").allowed).toBe(false);

    limiter.refund("k1");
    expect(limiter.consume("k1").allowed).toBe(true);
    expect(limiter.consume("k1").allowed).toBe(false);
  });

  it("refund 不超过 capacity 封顶；对未知 key 是 no-op", () => {
    const { limiter } = makeLimiter();
    limiter.refund("ghost");
    limiter.consume("k1");
    for (let i = 0; i < 25; i += 1) {
      limiter.refund("k1");
    }
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.consume("k1").allowed).toBe(true);
    }
    expect(limiter.consume("k1").allowed).toBe(false);
  });

  it("大量唯一 key 触发周期 sweep 后行为不变", () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 300; i += 1) {
      expect(limiter.consume(`probe-${i}`).allowed).toBe(true);
    }
    advance(60_000);
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.consume("probe-0").allowed).toBe(true);
    }
    expect(limiter.consume("probe-0").allowed).toBe(false);
  });
});

describe("FailedAuthAttempts", () => {
  it("bump 累加、peek 只读；超过 TTL 计数归零", () => {
    let nowMs = 0;
    const attempts = new FailedAuthAttempts(() => nowMs);
    expect(attempts.peek("1.1.1.1")).toBe(0);
    expect(attempts.bump("1.1.1.1")).toBe(1);
    expect(attempts.bump("1.1.1.1")).toBe(2);
    expect(attempts.peek("1.1.1.1")).toBe(2);

    nowMs += FAILED_AUTH_ATTEMPT_TTL_MS + 1;
    expect(attempts.peek("1.1.1.1")).toBe(0);
    expect(attempts.bump("1.1.1.1")).toBe(1);
  });

  it("周期 sweep 不吞存活计数；过期条目懒归零", () => {
    let nowMs = 0;
    const attempts = new FailedAuthAttempts(() => nowMs);
    attempts.bump("stale");
    for (let i = 0; i < 128; i += 1) {
      attempts.bump("hot");
    }
    nowMs += FAILED_AUTH_ATTEMPT_TTL_MS + 1;
    attempts.bump("hot");
    expect(attempts.peek("stale")).toBe(0);
    expect(attempts.peek("hot")).toBe(1);
  });
});
