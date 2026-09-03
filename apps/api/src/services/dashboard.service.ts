import {
  DASHBOARD_MATRIX_UNFILLED_KEY,
  type DashboardAnalysisStatsInput,
  DEFAULT_TICKET_SOURCE_FILTER,
  deriveDisplayStatus,
  reminderRulesSchema,
  type TicketSource,
  TicketStatus,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { applyDashboardDataScope } from "./data-scope.service.ts";
import { isFollowUpCheckpointHit, isRollingFollowUpHit } from "./follow-up-alert.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";
import { eligibilityRoleSelect, isAssigneeEligible } from "./ticket-assign.service.ts";
import { displayStatusTicketWhere } from "./ticket-display-status.ts";

/**
 * 数据看板双 procedure：actionStats 实时口径（无 createdRange，同一 clock.now()
 * 服务全部判定）；analysisStats 周期口径（trend/kinds/categories/sources/matrix
 * 与 agents 的周期列叠 createdRange，agents 的实时列不叠）。两者共享同一 base：
 * 软删排除 + DEFAULT_TICKET_SOURCE_FILTER（与列表默认一致排除 file_import）+
 * dashboard 数据范围（无 dashboard.view_all 钉 assigneeId = viewer）。
 *
 * - 超时/待超时谓词一律取自 displayStatusTicketWhere / deriveDisplayStatus——
 *   看板、列表、我的待办同一瞬间染红，此处禁止重述条件。
 * - 首响过线严格大于 slaAnchorAt + firstResponseMinutes（与"已超过"约定一致）；
 *   无策略 / 策略停用不计。slaAnchorAt 对退费单 = 平台 refundCreateTime，推送延迟
 *   计入等待。
 * - 已超时是实时运营视角（在途过 dueAt，完结即移出）；agents 周期列 overdueCount
 *   是历史追责视角（周期内创建名下单中曾超时：在途已超时 + completionTime > dueAt）。
 * - trend 分桶日界 = 服务器本地日（部署单时区约定，CONTEXT.md）；createdTo 缺省
 *   = now、createdFrom 缺省 = to 前 6 天（仅 trend 需要具体窗口，其余周期块无界）。
 * - matrix 实体下钻按反馈渠道目录名匹配（保司→project、经纪→brokerageEntity、
 *   支付→paymentChannel）：管理员改名后该行退化为无实体可展，不报错（CONTEXT.md 约定）。
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const UNFILLED_LABEL = "未填写";
const OTHERS_LABEL = "其他";
const UNSPECIFIED_POLICY_LABEL = "未指定策略";
const MATRIX_ENTITY_LIMIT = 8;
const CATEGORY_LIMIT = 10;

export interface DashboardActionStats {
  scope: "all" | "own";
  metrics: {
    overdue: number;
    dueSoon: number;
    awaitingFirstResponse: number;
    firstResponseOverLine: number;
    unassigned: number;
    unassignedOldestWaitMs: number | null;
  };
  policies: Array<{
    policyId: string | null;
    name: string;
    kindName: string | null;
    timeoutMs: number | null;
    inFlight: number;
    dueSoon: number;
    overdue: number;
  }>;
}

export interface DashboardAnalysisStats {
  scope: "all" | "own";
  trend: {
    granularity: "hour" | "day" | "week";
    points: Array<{ bucketStart: string; created: number; previous: number }>;
  };
  kinds: Array<{ kindId: string; name: string; count: number }>;
  categories: Array<{ categoryId: string | null; name: string; count: number }>;
  sources: Array<{ source: TicketSource; count: number }>;
  matrix: {
    columns: Array<{ id: string | null; name: string }>;
    rows: Array<{
      channelId: string | null;
      name: string;
      cells: Record<string, number>;
      entities: Array<{ name: string; cells: Record<string, number> }>;
    }>;
  };
  agents: Array<{
    assigneeId: string;
    name: string;
    inFlight: number;
    overdue: number;
    dueSoon: number;
    awaitingFirstResponse: number;
    followUpCheckpoints: number;
    followUpRolling: number;
    completed: number;
    avgCompletionMs: number | null;
    overdueCount: number;
    overdueRate: number;
  }>;
}

function dashboardBaseWhere(viewer: AuthenticatedUser): Prisma.TicketWhereInput {
  return {
    deletedAt: null,
    source: { in: [...DEFAULT_TICKET_SOURCE_FILTER] },
    ...applyDashboardDataScope(viewer),
  };
}

function createdRangeWhere(input: DashboardAnalysisStatsInput): Prisma.TicketWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (input.createdFrom !== undefined) {
    createdAt.gte = new Date(input.createdFrom);
  }
  if (input.createdTo !== undefined) {
    createdAt.lte = new Date(input.createdTo);
  }
  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
}

function viewerScope(viewer: AuthenticatedUser): "all" | "own" {
  return viewer.permissions.includes("dashboard.view_all") ? "all" : "own";
}

export async function getDashboardActionStats(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
): Promise<DashboardActionStats> {
  const now = clock.now();
  const base = dashboardBaseWhere(viewer);
  const and = (...filters: Prisma.TicketWhereInput[]): Prisma.TicketWhereInput => ({
    AND: [base, ...filters],
  });

  const policyRows = await prisma.slaPolicy.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      firstResponseMinutes: true,
      overdueHours: true,
      kind: { select: { name: true } },
    },
    orderBy: [{ kind: { displayOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
  });

  const [overdue, dueSoon, unassigned, unassignedOldest, awaitingRows, unspecifiedInFlight] =
    await Promise.all([
      prisma.ticket.count({ where: and(displayStatusTicketWhere("overdue", now)) }),
      prisma.ticket.count({ where: and(displayStatusTicketWhere("pending_timeout", now)) }),
      prisma.ticket.count({ where: and({ status: TicketStatus.Unassigned }) }),
      prisma.ticket.aggregate({
        where: and({ status: TicketStatus.Unassigned }),
        _min: { createdAt: true },
      }),
      prisma.ticket.findMany({
        where: and({
          status: { in: [TicketStatus.Assigned, TicketStatus.Processing] },
          contactCount: 0,
        }),
        select: { slaAnchorAt: true, slaPolicyId: true },
      }),
      prisma.ticket.count({
        where: and({ status: { not: TicketStatus.Completed }, slaPolicyId: null }),
      }),
    ]);

  // 首响过线只认 active 策略：policyRows 查不到的引用（停用/未指定）不计。
  const firstResponseMinutesByPolicy = new Map(
    policyRows.map((policy) => [policy.id, policy.firstResponseMinutes]),
  );
  let firstResponseOverLine = 0;
  for (const row of awaitingRows) {
    const minutes =
      row.slaPolicyId === null ? undefined : firstResponseMinutesByPolicy.get(row.slaPolicyId);
    if (minutes !== undefined && now.getTime() > row.slaAnchorAt.getTime() + minutes * MINUTE_MS) {
      firstResponseOverLine += 1;
    }
  }

  const policies = await Promise.all(
    policyRows.map(async (policy) => {
      // 不设处理时限的策略 dueAt 恒 null，两个超时口径恒 0，不必查。
      const hasTimeout = policy.overdueHours !== null;
      const [inFlight, policyDueSoon, policyOverdue] = await Promise.all([
        prisma.ticket.count({
          where: and({ status: { not: TicketStatus.Completed }, slaPolicyId: policy.id }),
        }),
        hasTimeout
          ? prisma.ticket.count({
              where: and(displayStatusTicketWhere("pending_timeout", now), {
                slaPolicyId: policy.id,
              }),
            })
          : Promise.resolve(0),
        hasTimeout
          ? prisma.ticket.count({
              where: and(displayStatusTicketWhere("overdue", now), { slaPolicyId: policy.id }),
            })
          : Promise.resolve(0),
      ]);
      return {
        policyId: policy.id,
        name: policy.name,
        kindName: policy.kind.name,
        timeoutMs: policy.overdueHours === null ? null : policy.overdueHours * HOUR_MS,
        inFlight,
        dueSoon: policyDueSoon,
        overdue: policyOverdue,
      };
    }),
  );

  const oldestUnassignedAt = unassignedOldest._min.createdAt;

  return {
    scope: viewerScope(viewer),
    metrics: {
      overdue,
      dueSoon,
      awaitingFirstResponse: awaitingRows.length,
      firstResponseOverLine,
      unassigned,
      unassignedOldestWaitMs:
        oldestUnassignedAt === null ? null : now.getTime() - oldestUnassignedAt.getTime(),
    },
    policies: [
      ...policies,
      {
        policyId: null,
        name: UNSPECIFIED_POLICY_LABEL,
        kindName: null,
        timeoutMs: null,
        inFlight: unspecifiedInFlight,
        dueSoon: 0,
        overdue: 0,
      },
    ],
  };
}

// 实体下钻维度按反馈渠道目录名匹配（目录行改名即退化为无实体可展，见文件头约定）。
const MATRIX_ENTITY_DIMENSIONS: ReadonlyMap<
  string,
  "project" | "brokerageEntity" | "paymentChannel"
> = new Map([
  ["保司", "project"],
  ["经纪", "brokerageEntity"],
  ["支付", "paymentChannel"],
]);

interface TrendBucket {
  start: Date;
  end: Date;
}

interface TrendWindow {
  granularity: "hour" | "day" | "week";
  unitMs: number;
  current: TrendBucket[];
  previous: TrendBucket[];
}

// 服务器本地日界（部署单时区约定，与排班的墙钟口径同源）。
function localDayStart(instant: Date): Date {
  return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

function shiftLocalDays(dayStart: Date, days: number): Date {
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + days);
}

function bucketsFrom(start: Date, count: number, unitMs: number): TrendBucket[] {
  return Array.from({ length: count }, (_, index) => ({
    start: new Date(start.getTime() + index * unitMs),
    end: new Date(start.getTime() + (index + 1) * unitMs),
  }));
}

function resolveTrendWindow(from: Date, to: Date): TrendWindow {
  const spanDays = (to.getTime() - from.getTime()) / DAY_MS;
  if (spanDays < 2) {
    const dayStart = localDayStart(from);
    return {
      granularity: "hour",
      unitMs: HOUR_MS,
      current: bucketsFrom(dayStart, 24, HOUR_MS),
      previous: bucketsFrom(shiftLocalDays(dayStart, -1), 24, HOUR_MS),
    };
  }
  if (spanDays <= 62) {
    const startDay = localDayStart(from);
    const days = Math.round((localDayStart(to).getTime() - startDay.getTime()) / DAY_MS) + 1;
    return {
      granularity: "day",
      unitMs: DAY_MS,
      current: Array.from({ length: days }, (_, index) => ({
        start: shiftLocalDays(startDay, index),
        end: shiftLocalDays(startDay, index + 1),
      })),
      previous: Array.from({ length: days }, (_, index) => ({
        start: shiftLocalDays(startDay, index - days),
        end: shiftLocalDays(startDay, index - days + 1),
      })),
    };
  }
  // 桶尾开区间但 createdTo 是闭区间：+1 桶兜住恰落 to 瞬间的工单。
  const weeks = Math.floor(spanDays / 7) + 1;
  return {
    granularity: "week",
    unitMs: 7 * DAY_MS,
    current: bucketsFrom(from, weeks, 7 * DAY_MS),
    previous: bucketsFrom(new Date(from.getTime() - weeks * 7 * DAY_MS), weeks, 7 * DAY_MS),
  };
}

function bucketIndex(buckets: TrendBucket[], unitMs: number, t: number): number {
  const first = buckets[0];
  if (first === undefined || t < first.start.getTime()) {
    return -1;
  }
  const index = Math.floor((t - first.start.getTime()) / unitMs);
  const bucket = buckets[index];
  if (bucket === undefined || t >= bucket.end.getTime()) {
    return -1;
  }
  return index;
}

function buildTrend(
  rows: Array<{ createdAt: Date }>,
  from: Date,
  to: Date,
): DashboardAnalysisStats["trend"] {
  const window = resolveTrendWindow(from, to);
  const createdCounts = window.current.map(() => 0);
  const previousCounts = window.previous.map(() => 0);
  for (const row of rows) {
    const t = row.createdAt.getTime();
    if (t >= from.getTime() && t <= to.getTime()) {
      const index = bucketIndex(window.current, window.unitMs, t);
      const count = createdCounts[index];
      if (count !== undefined) {
        createdCounts[index] = count + 1;
      }
    } else {
      const index = bucketIndex(window.previous, window.unitMs, t);
      const count = previousCounts[index];
      if (count !== undefined) {
        previousCounts[index] = count + 1;
      }
    }
  }
  return {
    granularity: window.granularity,
    points: window.current.map((bucket, index) => ({
      bucketStart: bucket.start.toISOString(),
      created: createdCounts[index] ?? 0,
      previous: previousCounts[index] ?? 0,
    })),
  };
}

function cellKey(columnId: string | null): string {
  return columnId ?? DASHBOARD_MATRIX_UNFILLED_KEY;
}

export async function getDashboardAnalysisStats(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  input: DashboardAnalysisStatsInput,
): Promise<DashboardAnalysisStats> {
  const now = clock.now();
  const scope = viewerScope(viewer);
  const base = dashboardBaseWhere(viewer);
  const period: Prisma.TicketWhereInput = { AND: [base, createdRangeWhere(input)] };
  const andBase = (...filters: Prisma.TicketWhereInput[]): Prisma.TicketWhereInput => ({
    AND: [base, ...filters],
  });
  const andPeriod = (...filters: Prisma.TicketWhereInput[]): Prisma.TicketWhereInput => ({
    AND: [period, ...filters],
  });

  const trendTo = input.createdTo === undefined ? now : new Date(input.createdTo);
  const trendFrom =
    input.createdFrom === undefined
      ? new Date(trendTo.getTime() - 6 * DAY_MS)
      : new Date(input.createdFrom);
  const trendWindow = resolveTrendWindow(trendFrom, trendTo);
  const trendFetchStart = trendWindow.previous[0]?.start ?? trendFrom;

  const [
    trendRows,
    kindCatalog,
    kindGroups,
    categoryCatalog,
    categoryGroups,
    sourceGroups,
    channelCatalog,
    feedbackChannelCatalog,
    matrixDetails,
  ] = await Promise.all([
    prisma.ticket.findMany({
      where: andBase({ createdAt: { gte: trendFetchStart, lte: trendTo } }),
      select: { createdAt: true },
    }),
    prisma.ticketKind.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    prisma.ticket.groupBy({ by: ["kindId"], where: period, _count: { _all: true } }),
    prisma.ticketCategory.findMany(),
    prisma.ticketComplaintDetail.groupBy({
      by: ["categoryId"],
      where: { ticket: period },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({ by: ["source"], where: period, _count: { _all: true } }),
    prisma.channel.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    prisma.userFeedbackChannel.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    prisma.ticketComplaintDetail.findMany({
      where: { ticket: period },
      select: {
        channelId: true,
        userFeedbackChannelId: true,
        project: true,
        brokerageEntity: true,
        paymentChannel: true,
      },
    }),
  ]);

  const trend = buildTrend(trendRows, trendFrom, trendTo);

  const kindCountById = new Map(kindGroups.map((group) => [group.kindId, group._count._all]));
  const kinds = kindCatalog.map((kind) => ({
    kindId: kind.id,
    name: kind.name,
    count: kindCountById.get(kind.id) ?? 0,
  }));

  const categoryNameById = new Map(categoryCatalog.map((category) => [category.id, category.name]));
  const filledCategories = categoryGroups
    .filter((group) => group.categoryId !== null)
    .map((group) => ({
      categoryId: group.categoryId,
      name: categoryNameById.get(group.categoryId ?? "") ?? "未知",
      count: group._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const topCategories = filledCategories.slice(0, CATEGORY_LIMIT);
  const otherCategoryCount = filledCategories
    .slice(CATEGORY_LIMIT)
    .reduce((sum, row) => sum + row.count, 0);
  const unfilledCategoryCount = categoryGroups
    .filter((group) => group.categoryId === null)
    .reduce((sum, group) => sum + group._count._all, 0);
  const categories: DashboardAnalysisStats["categories"] = [...topCategories];
  if (otherCategoryCount > 0) {
    categories.push({ categoryId: null, name: OTHERS_LABEL, count: otherCategoryCount });
  }
  if (unfilledCategoryCount > 0) {
    categories.push({ categoryId: null, name: UNFILLED_LABEL, count: unfilledCategoryCount });
  }

  const sourceCountBySource = new Map(
    sourceGroups.map((group) => [group.source, group._count._all]),
  );
  const sources = DEFAULT_TICKET_SOURCE_FILTER.map((source) => ({
    source,
    count: sourceCountBySource.get(source) ?? 0,
  }));

  const columns: DashboardAnalysisStats["matrix"]["columns"] = [
    ...feedbackChannelCatalog.map((channel) => ({
      id: channel.id as string | null,
      name: channel.name,
    })),
    { id: null, name: UNFILLED_LABEL },
  ];
  const emptyCells = (): Record<string, number> =>
    Object.fromEntries(columns.map((column) => [cellKey(column.id), 0]));

  const channelNameById = new Map(channelCatalog.map((channel) => [channel.id, channel.name]));
  interface MatrixRowAccum {
    cells: Record<string, number>;
    entities: Map<string, Record<string, number>>;
  }
  const rowAccums = new Map<string | null, MatrixRowAccum>();
  for (const detail of matrixDetails) {
    const channelName =
      detail.channelId === null ? undefined : channelNameById.get(detail.channelId);
    const dimension =
      channelName === undefined ? undefined : MATRIX_ENTITY_DIMENSIONS.get(channelName);
    let accum = rowAccums.get(detail.channelId);
    if (accum === undefined) {
      accum = { cells: emptyCells(), entities: new Map() };
      rowAccums.set(detail.channelId, accum);
    }
    const key = cellKey(detail.userFeedbackChannelId);
    accum.cells[key] = (accum.cells[key] ?? 0) + 1;
    if (dimension !== undefined) {
      const raw = detail[dimension];
      const entityName = raw === null || raw.trim() === "" ? UNFILLED_LABEL : raw;
      const entityCells = accum.entities.get(entityName) ?? emptyCells();
      entityCells[key] = (entityCells[key] ?? 0) + 1;
      accum.entities.set(entityName, entityCells);
    }
  }

  const buildEntities = (
    accum: MatrixRowAccum | undefined,
  ): Array<{ name: string; cells: Record<string, number> }> => {
    if (accum === undefined) {
      return [];
    }
    const ranked = [...accum.entities.entries()]
      .filter(([name]) => name !== UNFILLED_LABEL)
      .map(([name, cells]) => ({
        name,
        cells,
        total: Object.values(cells).reduce((sum, count) => sum + count, 0),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const top = ranked.slice(0, MATRIX_ENTITY_LIMIT);
    const rest = ranked.slice(MATRIX_ENTITY_LIMIT);
    const entities = top.map(({ name, cells }) => ({ name, cells }));
    if (rest.length > 0) {
      const otherCells = emptyCells();
      for (const row of rest) {
        for (const [key, count] of Object.entries(row.cells)) {
          otherCells[key] = (otherCells[key] ?? 0) + count;
        }
      }
      entities.push({ name: OTHERS_LABEL, cells: otherCells });
    }
    const unfilledCells = accum.entities.get(UNFILLED_LABEL);
    if (unfilledCells !== undefined) {
      entities.push({ name: UNFILLED_LABEL, cells: unfilledCells });
    }
    return entities;
  };

  const matrixRows: DashboardAnalysisStats["matrix"]["rows"] = [
    ...channelCatalog.map((channel) => {
      const accum = rowAccums.get(channel.id);
      const hasDimension = MATRIX_ENTITY_DIMENSIONS.has(channel.name);
      return {
        channelId: channel.id as string | null,
        name: channel.name,
        cells: accum?.cells ?? emptyCells(),
        entities: hasDimension ? buildEntities(accum) : [],
      };
    }),
    {
      channelId: null,
      name: UNFILLED_LABEL,
      cells: rowAccums.get(null)?.cells ?? emptyCells(),
      entities: [],
    },
  ];

  const agents = await buildAgentStats(prisma, now, scope, viewer, andBase, andPeriod);

  return {
    scope,
    trend,
    kinds,
    categories,
    sources,
    matrix: { columns, rows: matrixRows },
    agents,
  };
}

type AndFn = (...filters: Prisma.TicketWhereInput[]) => Prisma.TicketWhereInput;

async function buildAgentStats(
  prisma: TicketServiceDeps["prisma"],
  now: Date,
  scope: "all" | "own",
  viewer: AuthenticatedUser,
  andBase: AndFn,
  andPeriod: AndFn,
): Promise<DashboardAnalysisStats["agents"]> {
  const [
    candidateRows,
    policyRows,
    inFlightRows,
    periodTotals,
    completedRows,
    overdueInFlightGroups,
    overdueCompletedGroups,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, ...eligibilityRoleSelect },
    }),
    prisma.slaPolicy.findMany({
      where: { active: true },
      select: { id: true, reminderRules: true },
    }),
    prisma.ticket.findMany({
      where: andBase({ status: { not: TicketStatus.Completed }, assigneeId: { not: null } }),
      select: {
        id: true,
        assigneeId: true,
        status: true,
        dueAt: true,
        slaAnchorAt: true,
        contactCount: true,
        slaPolicyId: true,
      },
    }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: andPeriod(), _count: { _all: true } }),
    prisma.ticket.findMany({
      where: andPeriod({ status: TicketStatus.Completed, completionTime: { not: null } }),
      select: { assigneeId: true, createdAt: true, completionTime: true },
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: andPeriod(displayStatusTicketWhere("overdue", now)),
      _count: { _all: true },
    }),
    // 超时完结：完结晚于 dueAt。dueAt IS NULL（不设时限）比较不成立，永不命中。
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: andPeriod({
        status: TicketStatus.Completed,
        completionTime: { gt: prisma.ticket.fields.dueAt },
      }),
      _count: { _all: true },
    }),
  ]);

  // 责任人候选全集（启用 + 非外部角色 + ticket.view & ticket.process）零填充；
  // own scope 只剩 viewer 自己一行。
  const candidates = candidateRows.filter(
    (user) => isAssigneeEligible(user.role) && (scope === "all" || user.id === viewer.id),
  );

  const rulesByPolicy = new Map(
    policyRows.map((policy) => [policy.id, reminderRulesSchema.parse(policy.reminderRules)]),
  );

  // 滚动提醒时钟以上一条 comment 为基准，只查确有 rolling 规则工单的最新 comment。
  const rollingTicketIds = inFlightRows
    .filter((ticket) =>
      (ticket.slaPolicyId === null ? undefined : rulesByPolicy.get(ticket.slaPolicyId))?.some(
        (rule) => rule.type === "rolling_follow_up",
      ),
    )
    .map((ticket) => ticket.id);
  const lastCommentGroups = rollingTicketIds.length
    ? await prisma.processLog.groupBy({
        by: ["ticketId"],
        where: { ticketId: { in: rollingTicketIds }, action: "comment" },
        _max: { at: true },
      })
    : [];
  const lastCommentAtByTicket = new Map(
    lastCommentGroups.map((group) => [group.ticketId, group._max.at]),
  );

  interface RealTimeAccum {
    inFlight: number;
    overdue: number;
    dueSoon: number;
    awaitingFirstResponse: number;
    followUpCheckpoints: number;
    followUpRolling: number;
  }
  const zeroAccum = (): RealTimeAccum => ({
    inFlight: 0,
    overdue: 0,
    dueSoon: 0,
    awaitingFirstResponse: 0,
    followUpCheckpoints: 0,
    followUpRolling: 0,
  });
  const realTimeByAssignee = new Map<string, RealTimeAccum>();
  for (const ticket of inFlightRows) {
    if (ticket.assigneeId === null) {
      continue;
    }
    const accum = realTimeByAssignee.get(ticket.assigneeId) ?? zeroAccum();
    realTimeByAssignee.set(ticket.assigneeId, accum);
    accum.inFlight += 1;
    const displayStatus = deriveDisplayStatus(
      ticketStatusSchema.parse(ticket.status),
      ticket.dueAt,
      now,
    );
    if (displayStatus === "overdue") {
      accum.overdue += 1;
    } else if (displayStatus === "pending_timeout") {
      accum.dueSoon += 1;
    }
    if (
      (ticket.status === TicketStatus.Assigned || ticket.status === TicketStatus.Processing) &&
      ticket.contactCount === 0
    ) {
      accum.awaitingFirstResponse += 1;
    }
    // 策略停用即退出判定（rulesByPolicy 只含 active），未指定策略无跟进要求。
    const rules = ticket.slaPolicyId === null ? undefined : rulesByPolicy.get(ticket.slaPolicyId);
    if (rules !== undefined) {
      const lastCommentAt = lastCommentAtByTicket.get(ticket.id) ?? null;
      let checkpointHit = false;
      let rollingHit = false;
      for (const rule of rules) {
        if (rule.type === "follow_up_checkpoint") {
          checkpointHit = checkpointHit || isFollowUpCheckpointHit(rule, ticket, now);
        } else {
          rollingHit = rollingHit || isRollingFollowUpHit(rule, lastCommentAt, now);
        }
      }
      if (checkpointHit) {
        accum.followUpCheckpoints += 1;
      }
      if (rollingHit) {
        accum.followUpRolling += 1;
      }
    }
  }

  const totalByAssignee = new Map(
    periodTotals.map((group) => [group.assigneeId, group._count._all]),
  );
  const overdueInFlightByAssignee = new Map(
    overdueInFlightGroups.map((group) => [group.assigneeId, group._count._all]),
  );
  const overdueCompletedByAssignee = new Map(
    overdueCompletedGroups.map((group) => [group.assigneeId, group._count._all]),
  );
  const durations = new Map<string, { sumMs: number; count: number }>();
  for (const row of completedRows) {
    if (row.assigneeId === null || row.completionTime === null) {
      continue;
    }
    const entry = durations.get(row.assigneeId) ?? { sumMs: 0, count: 0 };
    entry.sumMs += row.completionTime.getTime() - row.createdAt.getTime();
    entry.count += 1;
    durations.set(row.assigneeId, entry);
  }

  return candidates
    .map((user) => {
      const realTime = realTimeByAssignee.get(user.id) ?? zeroAccum();
      const total = totalByAssignee.get(user.id) ?? 0;
      const duration = durations.get(user.id);
      const overdueCount =
        (overdueInFlightByAssignee.get(user.id) ?? 0) +
        (overdueCompletedByAssignee.get(user.id) ?? 0);
      return {
        assigneeId: user.id,
        name: user.name,
        ...realTime,
        completed: duration?.count ?? 0,
        avgCompletionMs: duration === undefined ? null : duration.sumMs / duration.count,
        overdueCount,
        overdueRate: total === 0 ? 0 : overdueCount / total,
      };
    })
    .sort(
      (a, b) =>
        b.inFlight - a.inFlight ||
        b.completed - a.completed ||
        a.name.localeCompare(b.name) ||
        a.assigneeId.localeCompare(b.assigneeId),
    );
}
