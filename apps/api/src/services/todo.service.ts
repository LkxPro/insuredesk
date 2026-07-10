import {
  type ReminderRule,
  TicketStatus,
  type TodoAlertType,
  type TodoSeverity,
  deriveDisplayStatus,
  reminderRulesSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 轨 2 我的待办 (issue #30, PRD §3.7/§3.8/§4.2, ADR 0004/0005): the viewer's
 * time-derived alert list, computed on every 30s poll and never stored. The
 * whole track is one read: my open tickets × the SLAPolicy predicates × now.
 *
 * Invariants the shape of this module enforces:
 * - the query is pinned to assigneeId = viewer.id — NOT the RBAC data scope.
 *   待办 is strictly personal even for a supervisor with ticket.view_all, and
 *   unassigned tickets (assigneeId null) can never match anyone (PRD §3.8
 *   告警归属). A 改派 moves every alert to the new owner by construction.
 * - status ≠ completed in the WHERE is the "completed 后全部告警停止" rule:
 *   dropping out of the query IS the stop, nothing to cancel (ADR 0004).
 * - overdue / due_soon are not restated: they come from deriveDisplayStatus,
 *   the same single-truth predicate the list and dashboard use (ADR 0001).
 * - checkpoint / rolling / 染红 thresholds all come from the SLAPolicy rows —
 *   an admin edit, or a complaintLevel edit, changes only the NEXT evaluation;
 *   a checkpoint whose window already passed simply never matches again, so
 *   "已过检查点不补发" needs no special case (ADR 0005).
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

interface TodoAlert {
  type: TodoAlertType;
  severity: TodoSeverity;
  message: string;
}

/** One duration component set, floored to whole minutes: "35 小时 20 分钟". */
function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  if (totalMinutes < 1) {
    return "不足 1 分钟";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return hours > 0 ? `${hours} 小时` : `${minutes} 分钟`;
}

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

  // A deleted policy row must not break the poll: SLA-driven alerts degrade
  // (待首响 stays warning, no checkpoints/rolling) while the policy-free
  // alerts (待首响 presence, due_soon/overdue from dueAt) keep working.
  // 未定级 tickets (complaintLevel null, issue #43) take the same degraded
  // path by construction: no policy → no SLA time alerts.
  const policies = new Map(
    policyRows.map((row) => [
      row.complaintLevel,
      {
        firstResponseMinutes: row.firstResponseMinutes,
        rules: reminderRulesSchema.parse(row.reminderRules),
      },
    ]),
  );

  const lookupPolicy = (complaintLevel: string | null) =>
    complaintLevel === null ? undefined : policies.get(complaintLevel);

  // 滚动提醒时钟以上一条 comment 为基准 (ADR 0005) — fetch the latest comment
  // instant, only for tickets whose policy actually has a rolling rule.
  const rollingTicketIds = tickets
    .filter((ticket) =>
      lookupPolicy(ticket.complaintLevel)?.rules.some((rule) => rule.type === "rolling_follow_up"),
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
    .map((ticket) => {
      const policy = lookupPolicy(ticket.complaintLevel);
      const alerts: TodoAlert[] = [];

      // 待首响: no first comment yet → in the todo from the moment it is
      // assigned, no trigger threshold. Strictly past firstResponseMinutes the
      // severity turns critical (超过 is strict, matching the overdue 已超过
      // convention) — a color change only, never a count (PRD §3.8).
      if (ticket.contactCount === 0) {
        const redLineMs =
          policy === undefined
            ? null
            : ticket.createdAt.getTime() + policy.firstResponseMinutes * MINUTE_MS;
        alerts.push({
          type: "awaiting_first_response",
          severity: redLineMs !== null && now.getTime() > redLineMs ? "critical" : "warning",
          message: `尚未首次跟进，已等待 ${formatDuration(now.getTime() - ticket.createdAt.getTime())}`,
        });
      }

      for (const rule of policy?.rules ?? []) {
        alerts.push(...evaluateRule(rule, ticket, lastCommentAt.get(ticket.id) ?? null, now));
      }

      // due_soon / overdue wear the shared display-status derivation as
      // alerts — the one place the time predicates live (ADR 0001).
      const displayStatus = deriveDisplayStatus(
        ticketStatusSchema.parse(ticket.status),
        ticket.dueAt,
        now,
      );
      if (displayStatus === "pending_timeout") {
        alerts.push({
          type: "due_soon",
          severity: "warning",
          message: "距处理时限不足 2 小时",
        });
      } else if (displayStatus === "overdue" && ticket.dueAt !== null) {
        alerts.push({
          type: "overdue",
          severity: "critical",
          message: `已超过处理时限 ${formatDuration(now.getTime() - ticket.dueAt.getTime())}`,
        });
      }

      return { ticket, alerts };
    })
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

/**
 * One SLAPolicy reminder rule against one ticket at one instant (ADR 0005:
 * rules run as read-time predicates — no send/dedup/idempotence concepts).
 */
function evaluateRule(
  rule: ReminderRule,
  ticket: { createdAt: Date; contactCount: number },
  lastCommentAt: Date | null,
  now: Date,
): TodoAlert[] {
  if (rule.type === "follow_up_checkpoint") {
    // In from (checkpoint − advance) inclusive, out at the checkpoint
    // exclusive — or the moment 累计 comments (contactCount, cumulative from
    // createdAt across assignees) reach requiredCount (PRD §3.8 判定语义).
    const checkpointMs = ticket.createdAt.getTime() + rule.checkpointHours * HOUR_MS;
    const windowStartMs = checkpointMs - rule.advanceMinutes * MINUTE_MS;
    if (
      now.getTime() >= windowStartMs &&
      now.getTime() < checkpointMs &&
      ticket.contactCount < rule.requiredCount
    ) {
      return [
        {
          type: "follow_up_checkpoint",
          severity: "warning",
          message: `${rule.checkpointHours} 小时检查点将至：已跟进 ${ticket.contactCount}/${rule.requiredCount} 次`,
        },
      ];
    }
    return [];
  }

  // rolling_follow_up (特急): the clock starts at the LAST comment (ADR 0005),
  // so before any comment exists there is nothing to roll from — the constant
  // 待首响 alert already holds the ticket in the todo until first contact.
  if (
    lastCommentAt !== null &&
    now.getTime() - lastCommentAt.getTime() >= rule.intervalHours * HOUR_MS
  ) {
    return [
      {
        type: "rolling_follow_up",
        severity: "critical",
        message: `距上次跟进已 ${formatDuration(now.getTime() - lastCommentAt.getTime())}，要求每 ${rule.intervalHours} 小时跟进`,
      },
    ];
  }
  return [];
}
