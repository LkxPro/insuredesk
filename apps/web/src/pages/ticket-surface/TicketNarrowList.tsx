import type { TicketDisplayStatus } from "@insuredesk/shared";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

/**
 * 详情态的左侧窄列：全宽表压缩后的样子，内外两端共用。行 = 客户名、状态、
 * 一个时间槽（内部传处理时限，外部传反馈时间，语义由调用方定），overdue
 * 行的时间红字。不显示工单号（窄列里它挤掉了真正要扫的信息，工单号在右侧
 * 详情头部）。行序沿用调用方列表当前的筛选/排序结果，不另发查询。
 */

export type NarrowListItem = {
  id: string;
  customerName: string | null;
  status: TicketDisplayStatus;
  time: string | null;
  overdue?: boolean;
};

export function TicketNarrowList({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly NarrowListItem[];
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
                  <StatusBadge status={item.status} />
                </div>
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    item.overdue === true && "text-destructive",
                  )}
                >
                  {formatDateTime(item.time)}
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
