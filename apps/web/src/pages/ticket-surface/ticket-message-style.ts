import type { TicketMessageAction } from "@insuredesk/shared";
import { cn } from "@/lib/utils";

export const TICKET_MESSAGE_TINT: Record<TicketMessageAction, { badge: string; box: string }> = {
  internal_note: { badge: "bg-muted text-muted-foreground", box: "bg-muted" },
  external_note: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
    box: "bg-blue-50 dark:bg-blue-950/40",
  },
  comment: {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300",
    box: "bg-amber-50 dark:bg-amber-950/40",
  },
};

export function ticketMessageBubbleClassName(action: TicketMessageAction, incoming: boolean) {
  return cn(
    "rounded-2xl px-3 py-2 text-sm shadow-sm",
    incoming
      ? cn("rounded-bl-sm border", TICKET_MESSAGE_TINT[action].box)
      : "rounded-br-sm bg-muted",
  );
}
