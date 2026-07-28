import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

/**
 * 处理态的左侧窄列：全宽表压缩后的样子。三个信息——客户名、状态、处理时限，
 * 超时行的时限红字。不显示工单号（窄列里它挤掉了真正要扫的信息，工单号在右侧
 * 详情头部）。行序与内容沿用全宽表当前的筛选/排序结果，不另发查询。
 */

type ListItem = inferRouterOutputs<AppRouter>["ticket"]["list"]["items"][number];

export function TicketNarrowList({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly ListItem[];
  selectedId: string;
  onSelect: (ticketId: string) => void;
}) {
  return (
    <nav aria-label="工单窄列" className="min-h-0 overflow-y-auto">
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-1 border-b px-3 py-2 text-left hover:bg-muted/50",
                  selected && "bg-muted",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{item.customerName || "—"}</span>
                  <StatusBadge status={item.displayStatus} />
                </div>
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    item.displayStatus === "overdue" && "text-destructive",
                  )}
                >
                  {formatDateTime(item.dueAt)}
                </span>
              </button>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">暂无匹配的工单</li>
        )}
      </ul>
    </nav>
  );
}
