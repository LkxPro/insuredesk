import {
  TicketStatus,
  evaluateTicketSla,
  normalizeReminderRules,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 轨 2 我的待办 (issue #30, PRD §3.7/§3.8/§4.2, ADR 0004/0005): the viewer's
 * time-derived alert list, computed on every 30s poll and never stored. The
 * whole track is one read: my open tickets × the rule-engine × now — the
 * alert judgment itself (待首响 thresholds, checkpoint windows, rolling
 * cadence, due_soon/overdue boundaries) lives in the shared rule-engine
 * (issue #47); this adapter owns only the queries and the list shape.
 *
 * Invariants the shape of this module enforces:
 * - the query is pinned to assigneeId = viewer.id — NOT the RBAC data scope.
 *   待办 is strictly personal even for a supervisor with ticket.view_all, and
 *   unassigned tickets (assigneeId null) can never match anyone (PRD §3.8
 *   告警归属). A 改派 moves every alert to the new owner by construction.
 * - status ≠ completed in the WHERE is the "completed 后全部告警停止" rule:
 *   dropping out of the query IS the stop, nothing to cancel (ADR 0004).
 * - checkpoint / rolling / 染红 thresholds all come from the SLAPolicy rows —
 *   an admin edit, or a complaintLevel edit, changes only the NEXT evaluation;
 *   a checkpoint whose window already passed simply never matches again, so
 *   "已过检查点不补发" needs no special case (ADR 0005).
 */

/**
 * The viewer's 我的待办: every open ticket of theirs carrying at least one
 * active time alert, worst first. `count` (tickets, not alerts) feeds the
 * red-dot badge.
 */
export async function listMyTodos({ prisma, clock }: TicketServiceDeps, viewer: AuthenticatedUser) {
  const now = clock.now();

  const [tickets, policyRows] = await Promise.all([
    prisma.ticket.findMany({
      // assigneeId pinned to the viewer + not-completed IS the todo universe
      // (see module doc); soft-deleted tickets alert nobody (PRD §4.5).
      where: { deletedAt: null, assigneeId: viewer.id, status: { not: TicketStatus.Completed } },
      select: {
        id: true,
        workOrderNumber: true,
        customerName: true,
        complaintLevel: true,
        status: true,
        createdAt: true,
        dueAt: true,
        contactCount: true,
      },
    }),
    prisma.slaPolicy.findMany(),
  ]);

  // A deleted policy row must not break the poll: the engine degrades a null
  // policy (待首响 stays warning, no checkpoints/rolling) while the
  // policy-free alerts (待首响 presence, due_soon/overdue from dueAt) keep
  // working. 未定级 tickets (complaintLevel null, issue #43) take the same
  // degraded path by construction: no policy → no SLA time alerts.
  const policies = new Map(
    policyRows.map((row) => [
      row.complaintLevel,
      {
        firstResponseMinutes: row.firstResponseMinutes,
        reminderRules: normalizeReminderRules(row.reminderRules),
      },
    ]),
  );

  const lookupPolicy = (complaintLevel: string | null) =>
    complaintLevel === null ? null : (policies.get(complaintLevel) ?? null);

  // 滚动提醒时钟以上一条 comment 为基准 (ADR 0005) — fetch the latest comment
  // instant, only for tickets whose policy actually has a rolling rule.
  const rollingTicketIds = tickets
    .filter((ticket) =>
      lookupPolicy(ticket.complaintLevel)?.reminderRules.some(
        (rule) => rule.type === "rolling_follow_up",
      ),
    )
    .map((ticket) => ticket.id);
  const lastComments = rollingTicketIds.length
    ? await prisma.processLog.groupBy({
        by: ["ticketId"],
        where: { ticketId: { in: rollingTicketIds }, action: "comment" },
        _max: { at: true },
        orderBy: { ticketId: "asc" },
      })
    : [];
  const lastCommentAt = new Map(lastComments.map((group) => [group.ticketId, group._max.at]));

  const items = tickets
    .map((ticket) => ({
      ticket,
      alerts: evaluateTicketSla(
        lookupPolicy(ticket.complaintLevel),
        {
          status: ticketStatusSchema.parse(ticket.status),
          createdAt: ticket.createdAt,
          dueAt: ticket.dueAt,
          commentCount: ticket.contactCount,
          lastCommentAt: lastCommentAt.get(ticket.id) ?? null,
        },
        now,
      ),
    }))
    .filter(({ alerts }) => alerts.length > 0)
    .map(({ ticket, alerts }) => ({
      ticketId: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      customerName: ticket.customerName,
      complaintLevel: ticket.complaintLevel,
      createdAt: ticket.createdAt.toISOString(),
      dueAt: ticket.dueAt?.toISOString() ?? null,
      severity: alerts.some((alert) => alert.severity === "critical")
        ? ("critical" as const)
        : ("warning" as const),
      alerts,
    }))
    // Worst first, then oldest ticket first; id breaks exact-createdAt ties so
    // consecutive polls can never reshuffle the list.
    .sort(
      (a, b) =>
        Number(b.severity === "critical") - Number(a.severity === "critical") ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.ticketId.localeCompare(b.ticketId),
    );

  return { items, count: items.length };
}
