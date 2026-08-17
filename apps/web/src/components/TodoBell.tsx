import type { AppRouter } from "@insuredesk/api";
import { NOTIFICATION_POLL_INTERVAL_MS, TODO_ALERT_LABELS } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { ListTodo } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * 轨 2 我的待办 red-dot indicator: the count of my tickets currently carrying
 * a time alert — 待首响 / 检查点未达 / 特急欠跟进 / due_soon / overdue — with
 * a popover list linking to each ticket.
 *
 * It consumes the SAME notification.list query as the inbox bell: react-query
 * dedupes the two hooks into one cache entry, so the 30s poll stays a single
 * request carrying both tracks. Nothing here is stored or marked read — an
 * alert disappears the moment its condition stops holding.
 */

type TodoItem = inferRouterOutputs<AppRouter>["notification"]["list"]["todo"]["items"][number];

export function TodoBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { data } = trpc.notification.list.useQuery(undefined, {
    refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
  });

  const items = data?.todo.items ?? [];
  const count = data?.todo.count ?? 0;

  function openTicket(item: TodoItem) {
    setOpen(false);
    navigate(`/tickets/${item.ticketId}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7"
          aria-label={count > 0 ? `我的待办（${count} 项）` : "我的待办"}
        >
          <ListTodo />
          {count > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-white"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2">
          <span className="text-sm font-medium">我的待办</span>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无待办</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto" aria-label="待办列表">
            {items.map((item) => (
              <li key={item.ticketId} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => openTicket(item)}
                  className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-accent"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "font-medium",
                        item.severity === "critical" && "text-destructive",
                      )}
                    >
                      {item.workOrderNumber}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {item.customerName ?? "—"}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {item.slaPolicyName ?? "—"}
                    </span>
                  </span>
                  {item.alerts.map((alert) => (
                    <span
                      key={alert.type}
                      data-severity={alert.severity}
                      className="flex items-baseline gap-1.5 text-xs"
                    >
                      {/* 黄转红 lives here: warning renders amber, critical red */}
                      <span
                        className={cn(
                          "shrink-0 rounded-sm px-1 py-px font-medium",
                          alert.severity === "critical"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-500",
                        )}
                      >
                        {TODO_ALERT_LABELS[alert.type]}
                      </span>
                      <span className="text-muted-foreground">{alert.message}</span>
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
