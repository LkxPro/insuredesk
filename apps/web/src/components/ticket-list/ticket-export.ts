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
  // 多选筛选以逗号连接；空数组 = 不过滤，来源除外（缺省排除归档单，空选须
  // 显式下传覆盖缺省）
  for (const key of [
    "status",
    "channelId",
    "categoryId",
    "completionStatusId",
    "complaintLevel",
    "source",
  ] as const) {
    const value = query[key];
    if (value === undefined) {
      continue;
    }
    if (value.length > 0 || key === "source") {
      params.set(key, value.join(","));
    }
  }
  if (query.search) {
    params.set("search", query.search);
  }
  // 创建时间区间随导出下传；缺省（全部）不写参数
  for (const key of ["createdFrom", "createdTo"] as const) {
    const value = query[key];
    if (value !== undefined) {
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
