import { format } from "date-fns";

/** ISO instant → "2026-07-09 14:30"; null-safe for optional fields. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  return format(new Date(iso), "yyyy-MM-dd HH:mm");
}
