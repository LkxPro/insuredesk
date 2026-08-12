import type { TicketExportFormat } from "@insuredesk/shared";
import { format as formatDate } from "date-fns";
import { downloadFile } from "@/lib/download";

/**
 * 外部导出 client: turns 「我的工单」当前筛选 into the
 * GET /api/external-tickets/export download. 翻页参数刻意丢（导出覆盖全部
 * 命中行）；浏览器 IANA 时区随车，文件日期列与列表本地时刻口径一致。
 */

/** 页面 URL 查询态的子集——导出只关心筛选，不关心页码。 */
export interface ExternalTicketExportFilters {
  status: readonly string[];
  search: string;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}

export function buildExternalTicketExportUrl(
  query: ExternalTicketExportFilters,
  format: TicketExportFormat,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const params = new URLSearchParams({ format, timeZone });
  // 多选状态逗号连接，与列表页 URL 约定一致；缺省（全部）不写参数
  if (query.status.length > 0) {
    params.set("status", query.status.join(","));
  }
  if (query.search) {
    params.set("search", query.search);
  }
  if (query.createdFrom !== undefined) {
    params.set("createdFrom", query.createdFrom);
  }
  if (query.createdTo !== undefined) {
    params.set("createdTo", query.createdTo);
  }
  return `/api/external-tickets/export?${params.toString()}`;
}

export async function downloadExternalTicketExport(
  query: ExternalTicketExportFilters,
  format: TicketExportFormat,
): Promise<void> {
  await downloadFile(
    buildExternalTicketExportUrl(query, format),
    `我的工单-${formatDate(new Date(), "yyyyMMdd-HHmm")}.${format}`,
  );
}
