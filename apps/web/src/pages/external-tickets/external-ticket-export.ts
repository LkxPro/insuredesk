import type { ExternalTicketSortField, TicketExportFormat, TicketStatus } from "@insuredesk/shared";
import { format as formatDate } from "date-fns";
import { downloadFile } from "@/lib/download";

export interface ExternalTicketExportFilters {
  status?: TicketStatus[];
  completionStatusId?: string[];
  search?: string;
  feedbackFrom?: string;
  feedbackTo?: string;
  sortBy: ExternalTicketSortField;
  sortOrder: "asc" | "desc";
}

export function buildExternalTicketExportUrl(
  filters: ExternalTicketExportFilters,
  format: TicketExportFormat,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const params = new URLSearchParams({
    format,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    timeZone,
  });
  for (const key of ["status", "completionStatusId"] as const) {
    const values = filters[key];
    if (values && values.length > 0) params.set(key, values.join(","));
  }
  for (const key of ["search", "feedbackFrom", "feedbackTo"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return `/api/external-tickets/export?${params.toString()}`;
}

export async function downloadExternalTicketExport(
  filters: ExternalTicketExportFilters,
  format: TicketExportFormat,
): Promise<void> {
  await downloadFile(
    buildExternalTicketExportUrl(filters, format),
    `我的工单-${formatDate(new Date(), "yyyyMMdd-HHmm")}.${format}`,
  );
}
