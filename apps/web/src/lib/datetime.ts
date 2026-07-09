import { format } from "date-fns";

/** ISO instant → "2026-07-09 14:30"; null-safe for optional fields. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  return format(new Date(iso), "yyyy-MM-dd HH:mm");
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Duration → "2天3.5小时" / "3.5小时" / "12分钟"; null-safe for "no data yet".
 * Two units at most — a 考核表 cell needs magnitude, not precision.
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "—";
  }
  if (ms < HOUR_MS) {
    return `${Math.round(ms / MINUTE_MS)}分钟`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = (ms - days * DAY_MS) / HOUR_MS;
  const hoursText = `${hours.toFixed(1).replace(/\.0$/, "")}小时`;
  if (days === 0) {
    return hoursText;
  }
  return hoursText === "0小时" ? `${days}天` : `${days}天${hoursText}`;
}
