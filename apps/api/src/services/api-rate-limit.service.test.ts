import { describe, expect, it } from "vitest";
import { ApiRateLimiter } from "./api-rate-limit.service.ts";

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
});
