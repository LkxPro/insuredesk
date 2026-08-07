import type { AppRouter } from "@insuredesk/api";
import type { ExternalTicketSortField } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/pages/tickets/StatusBadge";
import {
  type ExternalTicket,
  externalFieldLabel,
  externalFieldValue,
} from "./external-ticket-fields";

type ListItem = inferRouterOutputs<AppRouter>["externalTicket"]["list"]["items"][number];

const SORT_FIELD_BY_COLUMN: Partial<Record<string, ExternalTicketSortField>> = {
  feedbackTime: "feedbackTime",
  status: "status",
  completionStatusId: "completionStatus",
  processingResult: "latestActivityAt",
};

function fullListValue(item: ListItem, field: string) {
  const value = externalFieldValue(item as ExternalTicket, field);
  return value === null || value === undefined || value === "" ? "—" : value;
}

/** 一级列表为全宽字段表；打开详情后，同一查询结果压缩成左侧二级摘要列表。 */
export function ExternalTicketListPane({
  items,
  isLoading,
  selectedId,
  visibleFields,
  detailVisibleFields,
  sort,
  onSort,
  onSelect,
}: {
  items: readonly ListItem[];
  isLoading: boolean;
  selectedId: string | undefined;
  visibleFields: readonly string[];
  detailVisibleFields: readonly string[];
  sort: { by: ExternalTicketSortField; order: "asc" | "desc" };
  onSort: (field: ExternalTicketSortField) => void;
  onSelect: (ticketId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (selectedId === undefined) {
    return (
      <nav aria-label="工单列表" className="min-h-0 flex-1 overflow-auto">
        <Table className="block border-separate border-spacing-y-2 md:table md:border-spacing-y-0">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              {visibleFields.map((field) => {
                const sortField = SORT_FIELD_BY_COLUMN[field];
                const active = sortField === sort.by;
                return (
                  <TableHead key={field} className="whitespace-nowrap">
                    {sortField ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8"
                        onClick={() => onSort(sortField)}
                      >
                        {externalFieldLabel(field)}
                        {active && (sort.order === "asc" ? <ArrowUp /> : <ArrowDown />)}
                      </Button>
                    ) : (
                      externalFieldLabel(field)
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group">
            {items.map((item) => (
              <TableRow
                key={item.id}
                role="button"
                tabIndex={0}
                className="mb-2 block cursor-pointer rounded-md border p-2 md:mb-0 md:table-row md:rounded-none md:border-x-0 md:p-0"
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(item.id);
                }}
              >
                {visibleFields.map((field) => (
                  <TableCell
                    key={field}
                    className="flex max-w-none items-start justify-between gap-4 border-0 px-2 py-1.5 md:table-cell md:max-w-72 md:border-b md:px-2 md:py-2"
                  >
                    <span className="shrink-0 text-xs text-muted-foreground md:hidden">
                      {externalFieldLabel(field)}
                    </span>
                    <span className="min-w-0 truncate text-right md:text-left">
                      {fullListValue(item, field)}
                    </span>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </nav>
    );
  }

  return (
    <nav aria-label="工单列表" className="min-h-0 flex-1 overflow-y-auto">
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((item) => {
          const selected = item.id === selectedId;
          const awaitingReply = item.hasUnreadReply;
          const primary = detailVisibleFields.includes("customerName")
            ? item.customerName || "—"
            : detailVisibleFields.includes("workOrderNumber")
              ? item.workOrderNumber || "—"
              : "—";
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-2 border-b px-3 py-3 text-left hover:bg-muted/50",
                  selected && "bg-muted",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{primary}</span>
                  {detailVisibleFields.includes("status") && item.status && (
                    <StatusBadge status={item.status} />
                  )}
                </div>
                <div className="flex w-full min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs text-muted-foreground">
                    {formatDateTime(item.latestLog?.at ?? item.createdAt)}
                  </span>
                  {awaitingReply && <Badge className="ml-auto shrink-0">客服新回复</Badge>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
