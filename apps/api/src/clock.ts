/**
 * Injectable clock (ADR 0006): every business time derivation and read-time
 * predicate obtains "now" through a Clock, so tests can pin time. Pure
 * absolute-instant comparisons (e.g. session expiry) are exempt and may use
 * bare `new Date()`.
 */
export interface Clock {
  now(): Date;
}

/** Production clock: the real system time. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test clock pinned to a fixed instant. */
export function fixedClock(at: Date): Clock {
  return { now: () => at };
}
