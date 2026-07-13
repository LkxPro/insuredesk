import {
  CHANNELS,
  type Channel,
  type ComplaintLevel,
  DASHBOARD_TOP_ASSIGNEE_LIMIT,
  type DashboardMetricKey,
  TicketStatus,
} from "@insuredesk/shared";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { applyDashboardDataScope } from "./data-scope.service";
import { overdueTicketWhere, pendingTimeoutTicketWhere } from "./ticket-display-status";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 数据看板 aggregation: the 9 metric cards, the 4-channel distribution, and
 * the Top-10 跟进人考核表, all in one read.
 *
 * Every count shares one WHERE base: soft-delete exclusion plus the
 * dashboard data scope — no `dashboard.view_all` → statistics narrow to the
 * viewer's own tickets. The 预警/超时 cards reuse the single-truth time
 * predicates from ticket-display-status.ts, never restating them,
 * so the dashboard reddens at the same instant as the list and 我的待办.
 *
 * Two overdue 口径 coexist ON PURPOSE:
 * - 已超时 card  = 实时运营视角: in-flight past dueAt, drops out on completion
 * - 考核 超时单数 = 历史追责视角: ever overdue — in-flight past dueAt OR
 *   completed late (completionTime > dueAt)
 * 特急 (dueAt null) never counts in either.
 */

/** 特急投诉 — the level with no dueAt, surfaced as its own card. */
const URGENT_LEVEL = "特急投诉" satisfies ComplaintLevel;
/** 监管 — the channel regulators route through, surfaced as its own card. */
const REGULATORY_CHANNEL = "监管" satisfies Channel;

export interface DashboardAssigneeStats {
  assigneeId: string;
  /** Current display name via JOIN — attribution follows the CURRENT assignee. */
  assigneeName: string;
  /** 名下工单总数 (非软删) — the 超时率 denominator. */
  totalCount: number;
  /** 完单数: assigneeId = 该客服 且 status = completed. */
  completedCount: number;
  /** 平均完结时长 completionTime − createdAt (端到端口径); null when nothing completed. */
  avgCompletionMs: number | null;
  /** 超时单数: 曾超时 — 含超时完结与在途超时 (历史追责视角). */
  overdueCount: number;
  /** 超时率 = 超时单数 / 名下工单总数, in [0, 1]. */
  overdueRate: number;
}

export interface DashboardStats {
  /** "own" when the viewer lacks dashboard.view_all and sees only their tickets. */
  scope: "all" | "own";
  metrics: Record<DashboardMetricKey, number>;
  /** All 4 channels in CHANNELS order, zero-filled — the table shape is fixed. */
  channels: Array<{ channel: Channel; count: number }>;
  /** Top 10 by 完单数 (the leading 考核 dimension), 名下工单数 then id as tiebreaks. */
  assignees: DashboardAssigneeStats[];
}

export async function getDashboardStats(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
): Promise<DashboardStats> {
  // One instant serves every predicate in the read, so the 预警 and 超时 cards
  // can never disagree with each other about the same ticket.
  const now = clock.now();
  const scoped = applyDashboardDataScope(viewer);
  const base: Prisma.TicketWhereInput = { deletedAt: null, ...scoped };
  // Composed via AND so fragments can never clobber the scope's assigneeId pin.
  const and = (...filters: Prisma.TicketWhereInput[]): Prisma.TicketWhereInput => ({
    AND: [base, ...filters],
  });
  const anyAssignee: Prisma.TicketWhereInput = { assigneeId: { not: null } };

  const [
    statusGroups,
    pendingTimeout,
    overdue,
    urgent,
    regulatory,
    channelGroups,
    assigneeTotals,
    assigneeCompleted,
    assigneeOverdueInFlight,
    assigneeOverdueCompleted,
  ] = await Promise.all([
    // Promise.all, not $transaction: a batch transaction at the default read
    // committed level takes a fresh snapshot per statement anyway, so it buys
    // no cross-count consistency — and it degrades groupBy's payload typing.
    // orderBy on the group key satisfies groupBy's required-orderBy typing;
    // result order is irrelevant (lookups below are keyed, never positional).
    prisma.ticket.groupBy({
      by: ["status"],
      where: base,
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    prisma.ticket.count({ where: and(pendingTimeoutTicketWhere(now)) }),
    prisma.ticket.count({ where: and(overdueTicketWhere(now)) }),
    prisma.ticket.count({ where: and({ complaintLevel: URGENT_LEVEL }) }),
    prisma.ticket.count({ where: and({ channel: REGULATORY_CHANNEL }) }),
    prisma.ticket.groupBy({
      by: ["channel"],
      where: base,
      _count: { _all: true },
      orderBy: { channel: "asc" },
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: and(anyAssignee),
      _count: { _all: true },
      orderBy: { assigneeId: "asc" },
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: and(anyAssignee, { status: TicketStatus.Completed }),
      _count: { _all: true },
      orderBy: { assigneeId: "asc" },
    }),
    // 在途超时 — the same fragment the 已超时 card and the list filter use.
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: and(anyAssignee, overdueTicketWhere(now)),
      _count: { _all: true },
      orderBy: { assigneeId: "asc" },
    }),
    // 超时完结: completed later than its deadline. Column-to-column via field
    // reference; dueAt IS NULL (特急) compares to nothing and never matches.
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: and(anyAssignee, {
        status: TicketStatus.Completed,
        completionTime: { gt: prisma.ticket.fields.dueAt },
      }),
      _count: { _all: true },
      orderBy: { assigneeId: "asc" },
    }),
  ]);

  const statusCount = (status: (typeof TicketStatus)[keyof typeof TicketStatus]) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;

  const metrics: Record<DashboardMetricKey, number> = {
    // The 4 stored statuses partition the (scoped, non-deleted) set, so their
    // sum IS the total — one groupBy serves five cards.
    total: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
    unassigned: statusCount(TicketStatus.Unassigned),
    assigned: statusCount(TicketStatus.Assigned),
    processing: statusCount(TicketStatus.Processing),
    completed: statusCount(TicketStatus.Completed),
    pendingTimeout,
    overdue,
    urgent,
    regulatory,
  };

  const channels = CHANNELS.map((channel) => ({
    channel,
    count: channelGroups.find((group) => group.channel === channel)?._count._all ?? 0,
  }));

  // Merge the per-assignee rollups. The two overdue buckets are disjoint by
  // construction (in-flight vs completed), so adding them never double-counts.
  const rollups = new Map<
    string,
    { totalCount: number; completedCount: number; overdueCount: number }
  >();
  for (const group of assigneeTotals) {
    if (group.assigneeId !== null) {
      rollups.set(group.assigneeId, {
        totalCount: group._count._all,
        completedCount: 0,
        overdueCount: 0,
      });
    }
  }
  for (const group of assigneeCompleted) {
    const row = group.assigneeId === null ? undefined : rollups.get(group.assigneeId);
    if (row) row.completedCount = group._count._all;
  }
  for (const group of [...assigneeOverdueInFlight, ...assigneeOverdueCompleted]) {
    const row = group.assigneeId === null ? undefined : rollups.get(group.assigneeId);
    if (row) row.overdueCount += group._count._all;
  }

  const top = [...rollups.entries()]
    .sort(
      ([idA, a], [idB, b]) =>
        b.completedCount - a.completedCount ||
        b.totalCount - a.totalCount ||
        idA.localeCompare(idB),
    )
    .slice(0, DASHBOARD_TOP_ASSIGNEE_LIMIT);
  const topIds = top.map(([assigneeId]) => assigneeId);

  // Second phase, bounded to the 10 winners: current names, and the completed
  // rows whose completionTime − createdAt feeds 平均完结时长. Prisma cannot
  // aggregate a column difference, so the mean is taken here — over at most
  // 10 assignees' completed tickets.
  const [users, completedRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true },
    }),
    prisma.ticket.findMany({
      where: and({
        assigneeId: { in: topIds },
        status: TicketStatus.Completed,
        completionTime: { not: null },
      }),
      select: { assigneeId: true, createdAt: true, completionTime: true },
    }),
  ]);

  const durations = new Map<string, { sumMs: number; count: number }>();
  for (const row of completedRows) {
    if (row.assigneeId === null || row.completionTime === null) continue;
    const entry = durations.get(row.assigneeId) ?? { sumMs: 0, count: 0 };
    entry.sumMs += row.completionTime.getTime() - row.createdAt.getTime();
    entry.count += 1;
    durations.set(row.assigneeId, entry);
  }
  const nameById = new Map(users.map((user) => [user.id, user.name]));

  const assignees = top.map(([assigneeId, rollup]) => {
    const duration = durations.get(assigneeId);
    return {
      assigneeId,
      assigneeName: nameById.get(assigneeId) ?? "未知用户",
      totalCount: rollup.totalCount,
      completedCount: rollup.completedCount,
      avgCompletionMs: duration ? duration.sumMs / duration.count : null,
      overdueCount: rollup.overdueCount,
      overdueRate: rollup.totalCount === 0 ? 0 : rollup.overdueCount / rollup.totalCount,
    };
  });

  return {
    scope: viewer.permissions.includes("dashboard.view_all") ? "all" : "own",
    metrics,
    channels,
    assignees,
  };
}
