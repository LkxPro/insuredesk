import type { TicketExportFormat, TicketListQuery } from "@insuredesk/shared";
import { format as formatDate } from "date-fns";

/**
 * 导出工单 client (issue #34): turns the list page's current query into the
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
  for (const key of ["status", "channel", "complaintLevel", "source", "search"] as const) {
    const value = query[key];
    if (value) {
      params.set(key, value);
    }
  }
  return `/api/tickets/export?${params.toString()}`;
}

/** Server rejections carry `{ error }` JSON; anything else gets a generic line. */
async function extractError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) {
      return body.error;
    }
  } catch {
    // non-JSON body (proxy error page, say) — fall through
  }
  return `导出失败（${response.status}）`;
}

/**
 * Fetch the export and hand it to the browser as a file download. Session
 * cookies ride along automatically (same-origin). Throws with a displayable
 * message on any non-2xx, so the caller owns the toast.
 */
export async function downloadTicketExport(
  query: TicketListQuery,
  format: TicketExportFormat,
): Promise<void> {
  const response = await fetch(buildTicketExportUrl(query, format));
  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `工单导出-${formatDate(new Date(), "yyyyMMdd-HHmm")}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
