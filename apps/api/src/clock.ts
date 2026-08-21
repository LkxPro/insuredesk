/**
 * Injectable clock: every business time derivation and read-time
 * predicate obtains "now" through a Clock, so tests can pin time. Pure
 * absolute-instant comparisons (e.g. session expiry) are exempt and may use
 * bare `new Date()`.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}
