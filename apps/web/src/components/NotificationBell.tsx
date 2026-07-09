import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { AppRouter } from "@insuredesk/api";
import { NOTIFICATION_POLL_INTERVAL_MS } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * 轨 1 收件箱 bell (issue #25, PRD §3.7, ADR 0004): polls notification.list
 * every 30 seconds — unread-count red badge, a toast for each newly arrived
 * notification, and a popover inbox where clicking an entry marks it read and
 * jumps to the ticket detail.
 */

/** Server list-item shape, inferred from the router — one contract, no drift. */
type NotificationItem = inferRouterOutputs<AppRouter>["notification"]["list"]["items"][number];

/** Beyond this many arrivals in one poll, collapse into a single summary toast. */
const MAX_INDIVIDUAL_TOASTS = 3;

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data } = trpc.notification.list.useQuery(undefined, {
    refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
  });
  const invalidate = () => utils.notification.list.invalidate();
  const markRead = trpc.notification.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notification.markAllRead.useMutation({ onSuccess: invalidate });

  function openTicket(notification: NotificationItem) {
    if (!notification.read) {
      markRead.mutate({ id: notification.id });
    }
    setOpen(false);
    if (notification.ticketId) {
      navigate(`/tickets/${notification.ticketId}`);
    }
  }

  // 来了弹 toast: announce only notifications that ARRIVE while the app is
  // open, diffed by id — not by a createdAt watermark, because timestamps are
  // stamped before the transaction commits, so a poll landing between two
  // out-of-order commits would silently skip the earlier-stamped one. The set
  // starts from the first poll: pre-existing unread items light the badge
  // without a login toast storm. A bulk arrival (批量分配) collapses into one
  // summary toast instead of stacking dozens.
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) {
      return;
    }
    if (seenIds.current === null) {
      seenIds.current = new Set(data.items.map((item) => item.id));
      return;
    }
    const seen = seenIds.current;
    const fresh = data.items.filter((item) => !item.read && !seen.has(item.id));
    for (const item of data.items) {
      seen.add(item.id); // before toasting: StrictMode-safe
    }
    if (fresh.length > MAX_INDIVIDUAL_TOASTS) {
      toast(`你有 ${fresh.length} 条新通知`, {
        action: { label: "查看", onClick: () => setOpen(true) },
      });
      return;
    }
    for (const item of fresh) {
      toast(item.title, {
        description: item.content,
        action: { label: "查看", onClick: () => openTicket(item) },
      });
    }
  });

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7"
          aria-label={unreadCount > 0 ? `通知（${unreadCount} 条未读）` : "通知"}
        >
          <Bell />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">通知</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markAllRead.mutate()}
            >
              全部已读
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无通知</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto" aria-label="通知列表">
            {items.map((item) => (
              <li key={item.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => openTicket(item)}
                  className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    {/* Unread dot */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        item.read ? "bg-transparent" : "bg-destructive",
                      )}
                    />
                    <span className={cn("text-sm", !item.read && "font-medium")}>{item.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </span>
                  <span className="pl-4 text-xs text-muted-foreground">{item.content}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
