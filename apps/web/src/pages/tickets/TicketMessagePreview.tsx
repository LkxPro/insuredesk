import { isTicketMessage, type TicketMessageAction } from "@insuredesk/shared";
import { HoverCard } from "radix-ui";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ticketMessageBubbleClassName } from "@/pages/ticket-surface/ticket-message-style";
import { Unknown } from "@/pages/ticket-surface/Unknown";
import type { TicketDetail } from "./ticket-detail";

export function TicketMessagePreview({
  ticketId,
  message,
  action,
  path,
}: {
  ticketId: string;
  message: string | null;
  action: TicketMessageAction | null;
  path: string;
}) {
  const [open, setOpen] = useState(false);
  const history = trpc.ticket.detail.useQuery({ id: ticketId }, { enabled: open });

  if (!message) return <Unknown />;
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={250} closeDelay={200}>
      <HoverCard.Trigger asChild>
        <Link
          to={path}
          className="block w-0 min-w-full outline-offset-2"
          onClick={(event) => event.stopPropagation()}
        >
          <span
            className={cn(
              ticketMessageBubbleClassName(action ?? "internal_note", action === "external_note"),
              "inline-block max-w-full truncate py-1 align-middle",
            )}
          >
            {message}
          </span>
        </Link>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[28rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          onClick={(event) => event.stopPropagation()}
        >
          {history.isError ? (
            <p role="alert" className="m-0 p-4 text-sm text-destructive">
              沟通记录加载失败，请重新悬停重试。
            </p>
          ) : history.data ? (
            <MessageHistory logs={history.data.processLogs} fetching={history.isFetching} />
          ) : (
            <div role="status" aria-label="加载沟通记录" className="flex flex-col gap-3 p-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-10 w-3/4 self-end" />
            </div>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function MessageHistory({
  logs,
  fetching,
}: {
  logs: TicketDetail["processLogs"];
  fetching: boolean;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  const positioned = useRef(false);
  useLayoutEffect(() => {
    if (positioned.current) return;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    positioned.current = !fetching;
  }, [fetching]);

  return (
    <section
      ref={scrollRef}
      aria-label="沟通记录"
      onScroll={(event) => {
        const container = event.currentTarget;
        if (container.scrollHeight - container.clientHeight - container.scrollTop > 1) {
          positioned.current = true;
        }
      }}
      className="max-h-[min(24rem,var(--radix-hover-card-content-available-height,24rem))] overflow-y-auto overscroll-contain p-4"
    >
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {logs.filter(isTicketMessage).map((log) => (
          <li
            key={log.id}
            className={cn(
              ticketMessageBubbleClassName(log.action, log.action === "external_note"),
              "max-w-[90%] whitespace-pre-wrap wrap-anywhere",
              log.action === "external_note" ? "self-start" : "self-end",
            )}
          >
            {log.remark}
          </li>
        ))}
      </ol>
    </section>
  );
}
