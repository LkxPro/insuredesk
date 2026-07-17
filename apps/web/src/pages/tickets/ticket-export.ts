import type { TicketExportFormat, TicketListQuery } from "@insuredesk/shared";
import { format as formatDate } from "date-fns";
import { downloadFile } from "@/lib/download";

/**
 * 导出工单 client: turns the list page's current query into the
 * GET /api/tickets/export download. Split from the page so the URL building —
 * the "按列表当前筛选条件导出" contract — is a pure, testable function.
 */

/**
 * Current list state → export URL. Pagination is deliberately dropped (an
 * export covers every matching row); the browser's IANA zone rides along so
 * the file's date columns match what the list page displays (local time).
 */
export function buildTicketExportUrl(
  query: TicketListQuery,
  format: TicketExportFormat,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const params = new URLSearchParams({
    format,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    timeZone,
  });
  for (const key of ["status", "channelId", "complaintLevel", "source", "search"] as const) {
    const value = query[key];
    if (value) {
      params.set(key, value);
    }
  }
  return `/api/tickets/export?${params.toString()}`;
}

export async function downloadTicketExport(
  query: TicketListQuery,
  format: TicketExportFormat,
): Promise<void> {
  await downloadFile(
    buildTicketExportUrl(query, format),
    `工单导出-${formatDate(new Date(), "yyyyMMdd-HHmm")}.${format}`,
  );
}
