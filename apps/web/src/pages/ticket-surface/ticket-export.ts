import type { TicketExportFormat, TicketListQuery } from "@insuredesk/shared";
import { format as formatDate } from "date-fns";
import { downloadFile } from "@/lib/download";

/** 导出覆盖筛选全集；请求传递本地时区，确保日期列与列表一致。 */
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
    "kindId",
    "channelId",
    "categoryId",
    "completionStatusId",
    "creatorId",
    "slaPolicyId",
    "userFeedbackChannelId",
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
  if (query.locationCode) {
    params.set("locationCode", query.locationCode);
  }
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
  // 文件格式由服务端按筛选决定，文件名只能取 Content-Disposition。
  await downloadFile(
    buildTicketExportUrl(query, format),
    `工单导出-${formatDate(new Date(), "yyyyMMdd-HHmm")}`,
    { preferServerFilename: true },
  );
}
