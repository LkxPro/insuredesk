import { formatInTimeZone } from "date-fns-tz";

/**
 * Display-time conversion to the system-wide 东八区 convention (ADR 0006):
 * instants are stored/transported as UTC ISO-8601 and rendered in
 * Asia/Shanghai at the UI boundary, regardless of the browser's zone.
 */
export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

/** ISO instant → "2026-07-09 14:30" in 东八区; null-safe for optional fields. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  return formatInTimeZone(iso, DISPLAY_TIME_ZONE, "yyyy-MM-dd HH:mm");
}
