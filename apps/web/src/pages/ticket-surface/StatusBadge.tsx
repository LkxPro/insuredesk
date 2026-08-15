import { TICKET_STATUS_LABELS, type TicketDisplayStatus } from "@insuredesk/shared";
import { Badge } from "@/components/ui/badge";

/**
 * Status badge shared by the list and detail pages, keyed on the *display*
 * status — the computed pending_timeout/overdue tints included, so every
 * surface colors a status the same way.
 */

/** Status color coding on the shared Badge; tints, not solid fills. */
const statusBadgeClasses: Record<TicketDisplayStatus, string> = {
  unassigned: "bg-muted text-muted-foreground",
  assigned: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  processing: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  pending_timeout: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function StatusBadge({ status }: { status: TicketDisplayStatus }) {
  return (
    <Badge variant="outline" className={statusBadgeClasses[status]}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}
