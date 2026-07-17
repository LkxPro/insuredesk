/**
 * IANA zone if the runtime knows it; otherwise UTC. Export formatting and
 * import parsing share this degradation, so a hand-edited zone never fails a
 * download/upload — the instants stay correct either way.
 */
export function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}
