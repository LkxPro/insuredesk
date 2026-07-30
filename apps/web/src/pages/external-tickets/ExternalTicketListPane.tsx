import type { AppRouter } from "@insuredesk/api";
import { PROCESS_LOG_ACTION_LABELS } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/pages/tickets/StatusBadge";

/**
 * 行列表：固定 schema——工单号 / 状态 / 「客服新发言」徽标 / 最新跟进
 * 摘要 / 时间，不放业务字段（身份字段按账号盖章，同账号行内是常量，零区分
 * 价值）。行序即服务端排定的序（客服新发言在前），这里只管渲染与选中。
 *
 * 「客服新发言」纯派生：最新一条可见处理记录是客服的 comment = 球在你这边；
 * 是你自己的留言或建单则无徽标（等客服）。最新活跃时刻取最新可见记录的
 * at，与排序键同源。
 */

type ListItem = inferRouterOutputs<AppRouter>["externalTicket"]["list"]["items"][number];

/** 最新跟进摘要：动作标签 + 有 remark 才拼内容（建单/完结的 remark 可能为空）。 */
function latestSummary(item: ListItem): string {
  const log = item.latestLog;
  if (!log) {
    return "—";
  }
  const label = PROCESS_LOG_ACTION_LABELS[log.action];
  return log.remark ? `${label}：${log.remark}` : label;
}

export function ExternalTicketListPane({
  items,
  isLoading,
  selectedId,
  onSelect,
}: {
  items: readonly ListItem[];
  isLoading: boolean;
  selectedId: string | undefined;
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

  return (
    <nav aria-label="工单列表" className="min-h-0 flex-1 overflow-y-auto">
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((item) => {
          const selected = item.id === selectedId;
          const awaitingReply = item.latestLog?.action === "comment";
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
                  <span className="truncate text-sm font-medium">{item.workOrderNumber}</span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="flex w-full min-w-0 items-center gap-1.5">
                  {awaitingReply && <Badge className="shrink-0">客服新发言</Badge>}
                  <span className="truncate text-xs text-muted-foreground">
                    {latestSummary(item)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(item.latestLog?.at ?? item.createdAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
