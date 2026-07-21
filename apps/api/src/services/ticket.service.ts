import {
  complaintLevelSchema,
  deriveDisplayStatus,
  formatFirstResponseRequirement,
  formatFollowUpFrequency,
  isCreatorBackedSource,
  nuclearBodyStatusSchema,
  prioritySchema,
  processLogActionSchema,
  reminderRulesSchema,
  TICKET_CREATE_FIELD_KEYS,
  TICKET_FIELDS,
  TICKET_SOURCE_LABELS,
  type TicketCreateData,
  type TicketCreateFieldKey,
  type TicketListQuery,
  TicketStatus,
  ticketSourceSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Clock } from "../clock";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { channelCatalog } from "./channel.service";
import { applyTicketDataScope } from "./data-scope.service";
import { ticketCategoryCatalog } from "./ticket-category.service";
import { displayStatusTicketWhere } from "./ticket-display-status";

/**
 * Ticket domain logic: manual creation and detail reads. Pure service
 * layer — no tRPC/HTTP types; the router maps domain errors to transport
 * codes.
 */

export interface TicketServiceDeps {
  prisma: PrismaClient;
  clock: Clock;
}

/** Every complaint level must have a seeded SLAPolicy row; missing one is a config fault. */
export class SlaPolicyNotConfiguredError extends Error {
  constructor(complaintLevel: string) {
    super(`投诉等级「${complaintLevel}」缺少 SLA 策略配置`);
    this.name = "SlaPolicyNotConfiguredError";
  }
}

/** 角色建单必填字段校验失败：缺任一必填字段即拒绝，一次性报出全部缺失。 */
export class RequiredFieldsMissingError extends Error {
  constructor(missingFields: string[]) {
    super(`以下字段为必填项：${missingFields.join("、")}`);
    this.name = "RequiredFieldsMissingError";
  }
}

const HOUR_MS = 60 * 60 * 1000;

/** Wire ISO-8601 datetime string (null = 未填写) → Date for persistence. */
export function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/**
 * THE dueAt formula: createdAt + the level's overdueHours, null for 特急
 * (no deadline). Creation stamps it; a complaintLevel edit re-runs it with
 * the new level's hours against the same unchanging createdAt.
 */
export function computeDueAt(createdAt: Date, overdueHours: number | null): Date | null {
  return overdueHours === null ? null : new Date(createdAt.getTime() + overdueHours * HOUR_MS);
}

/**
 * The SLA fields a complaintLevel stamps onto a ticket. A null level (未定级)
 * stamps all-null: no dueAt, no 首响/跟进 requirements — and hence
 * no SLA time alerts until an edit sets a level (off the original createdAt).
 */
export async function computeSlaStamp(
  db: Pick<PrismaClient, "slaPolicy">,
  complaintLevel: string | null,
  createdAt: Date,
): Promise<{
  dueAt: Date | null;
  followUpFrequency: string | null;
  firstResponseRequirement: string | null;
}> {
  if (complaintLevel === null) {
    return { dueAt: null, followUpFrequency: null, firstResponseRequirement: null };
  }
  const policy = await db.slaPolicy.findUnique({ where: { complaintLevel } });
  if (!policy) {
    throw new SlaPolicyNotConfiguredError(complaintLevel);
  }
  return {
    dueAt: computeDueAt(createdAt, policy.overdueHours),
    followUpFrequency: formatFollowUpFrequency(reminderRulesSchema.parse(policy.reminderRules)),
    firstResponseRequirement: formatFirstResponseRequirement(policy.firstResponseMinutes),
  };
}

/**
 * 校验角色建单必填字段集：每项属于清单且值非空（三态字段必须明确选是/否，
 * 多值字段的空数组＝未填写）。缺失字段一次性全部报出，字段名＝描述表标准名
 * （与表单可见 label 对上）。读取时忽略未知 key（防御字段改名）。
 */
function validateRequiredFields(input: TicketCreateData, requiredFields: string[]): void {
  const missingLabels: string[] = [];
  for (const field of requiredFields) {
    if (!TICKET_CREATE_FIELD_KEYS.includes(field as TicketCreateFieldKey)) {
      continue;
    }
    const value = input[field as TicketCreateFieldKey];
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      missingLabels.push(TICKET_FIELDS[field as TicketCreateFieldKey].label);
    }
  }
  if (missingLabels.length > 0) {
    throw new RequiredFieldsMissingError(missingLabels);
  }
}

/**
 * Create a manually-entered ticket:
 *
 * - every user field is optional: a fully blank submission is valid,
 *   unfilled fields persist as NULL ("unknown", never "")
 * - requiredTicketFields of creator's role: missing any → reject with all missing fields
 * - workOrderNumber comes from the Postgres sequence default (concurrency-safe)
 * - dueAt is fixed once, here: createdAt + the level's SLA overdueHours
 *   (null for 特急 — never overdue; null while 未定级 — no SLA clock fields)
 * - 跟进频次/首响要求 are stamped from the level's SLA config, not hardcoded
 * - source=manual records creatorId; "由谁创建" derives at read time
 * - the first `create` ProcessLog (operator name snapshot) lands in the same
 *   transaction, so a ticket can never exist without its timeline root
 */
export async function createTicket(
  { prisma, clock }: TicketServiceDeps,
  creator: AuthenticatedUser,
  input: TicketCreateData,
) {
  const role = await prisma.role.findUnique({
    where: { id: creator.roleId },
    select: { requiredTicketFields: true },
  });
  if (role) {
    validateRequiredFields(input, role.requiredTicketFields);
  }

  const now = clock.now();
  const slaStamp = await computeSlaStamp(prisma, input.complaintLevel, now);

  return prisma.$transaction(async (tx) => {
    // 校验与插入同事务（与编辑路径的时序一致）；并发删除由 FK Restrict 兜底
    await ticketCategoryCatalog.resolveNewRef(tx, input.categoryId);
    await channelCatalog.resolveNewRef(tx, input.channelId);

    const ticket = await tx.ticket.create({
      data: {
        ...input,
        feedbackTime: toDateOrNull(input.feedbackTime),
        contactTime: toDateOrNull(input.contactTime),
        createdAt: now,
        source: "manual",
        creatorId: creator.id,
        status: TicketStatus.Unassigned,
        ...slaStamp,
      },
    });

    await tx.processLog.create({
      data: {
        ticketId: ticket.id,
        operatorId: creator.id,
        // Name snapshot on purpose: the timeline shows who it was
        // at the time, even after renames — unlike the derived createdBy.
        operatorName: creator.name,
        action: "create",
        remark: "创建工单",
        at: now,
      },
    });

    return ticket;
  });
}

const listInclude = {
  // Current follow-up owner is derived via JOIN, never stored
  assignee: { select: { name: true } },
  // Catalog references render their CURRENT names — a rename shows through
  category: { select: { name: true } },
  channel: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type TicketListRow = Prisma.TicketGetPayload<{ include: typeof listInclude }>;

/** The list's filter/sort subset — shared verbatim by the export. */
type TicketListFilters = Pick<
  TicketListQuery,
  | "status"
  | "channelId"
  | "categoryId"
  | "completionStatusId"
  | "complaintLevel"
  | "source"
  | "search"
  | "sortBy"
  | "sortOrder"
>;

/**
 * 保单号搜索支的命中 id 预取。搜索契约是子串、不区分大小写，且以各值的
 * 空格连接形态整体匹配（带空格的搜索词可跨值命中）；Prisma 的标量数组
 * 过滤器只有整项精确匹配，表达不了这条谓词，故走 raw SQL。
 */
async function searchPolicyNumbersTicketIds(
  prisma: PrismaClient,
  search: string,
): Promise<string[]> {
  // 直接 %拼接%、不转义 LIKE 元字符——Prisma `contains` 就是这么做的，工单号/
  // 客户姓名两支同款；这支若单独转义，三支的搜索语义会分叉。
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tickets WHERE array_to_string("policyNumbers", ' ') ILIKE ${`%${search}%`}
  `;
  return rows.map((row) => row.id);
}

/**
 * The ONE WHERE for "what this viewer's filtered list contains" — shared by
 * the paged list and the export so the two can never disagree. Applies:
 *
 * - soft-delete exclusion (deletedAt null)
 * - the RBAC data scope — no `ticket.view_all` → only tickets assigned to or
 *   created by the viewer, so the rest of the unassigned pool never reaches
 *   一线客服
 * - the filters, with computed statuses resolved through the single-truth
 *   predicate module rather than restated here
 */
export async function buildTicketListWhere(
  prisma: PrismaClient,
  viewer: AuthenticatedUser,
  query: TicketListFilters,
  now: Date,
): Promise<Prisma.TicketWhereInput> {
  // Each filter is its own AND element so their inner ORs (base-status
  // predicate, search) can never collide.
  const filters: Prisma.TicketWhereInput[] = [];
  if (query.status) {
    filters.push(displayStatusTicketWhere(query.status, now));
  }
  if (query.channelId) {
    filters.push({ channelId: query.channelId });
  }
  if (query.categoryId) {
    filters.push({ categoryId: query.categoryId });
  }
  if (query.completionStatusId) {
    filters.push({ completionStatusId: query.completionStatusId });
  }
  if (query.complaintLevel) {
    filters.push({ complaintLevel: query.complaintLevel });
  }
  if (query.source) {
    filters.push({ source: query.source });
  }
  if (query.search) {
    filters.push({
      OR: [
        { workOrderNumber: { contains: query.search, mode: "insensitive" } },
        { customerName: { contains: query.search, mode: "insensitive" } },
        { id: { in: await searchPolicyNumbersTicketIds(prisma, query.search) } },
      ],
    });
  }

  return {
    deletedAt: null,
    ...applyTicketDataScope(viewer),
    AND: filters,
  };
}

/** The list's ordering, shared with the export for row-for-row consistency. */
export function buildTicketListOrderBy(
  query: TicketListFilters,
): Prisma.TicketOrderByWithRelationInput[] {
  // dueAt is nullable (特急 has none): those rows sort last either direction —
  // "no deadline" is never "most urgent"
  const orderBy: Prisma.TicketOrderByWithRelationInput =
    query.sortBy === "dueAt"
      ? { dueAt: { sort: query.sortOrder, nulls: "last" } }
      : { createdAt: query.sortOrder };
  // id breaks ordering ties so pagination never skips or repeats a row
  return [orderBy, { id: "desc" }];
}

/**
 * Paged ticket list for 工单管理: the shared WHERE/ORDER above,
 * plus pagination. One `clock.now()` serves the whole request, so the rows a
 * computed-status filter selects and the displayStatus they serialize with can
 * never disagree.
 */
export async function listTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: TicketListQuery,
) {
  const now = clock.now();
  const where = await buildTicketListWhere(prisma, viewer, query, now);

  const [rows, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      include: listInclude,
      orderBy: buildTicketListOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    items: rows.map((row) => serializeTicketListItem(row, now)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Re-narrow a nullable enum-like String column; null (未填写) passes through. */
function parseNullable<T>(
  schema: { parse: (value: unknown) => T },
  value: string | null,
): T | null {
  return value === null ? null : schema.parse(value);
}

/** Wire shape of one list row — the list's columns, nothing more. */
function serializeTicketListItem(ticket: TicketListRow, now: Date) {
  const source = ticketSourceSchema.parse(ticket.source);
  const status = ticketStatusSchema.parse(ticket.status);

  return {
    id: ticket.id,
    workOrderNumber: ticket.workOrderNumber,
    createdAt: ticket.createdAt.toISOString(),
    source,
    channel: ticket.channel?.name ?? null,
    category: ticket.category?.name ?? null,
    complaintLevel: parseNullable(complaintLevelSchema, ticket.complaintLevel),
    customerName: ticket.customerName,
    policyNumbers: ticket.policyNumbers,
    status,
    displayStatus: deriveDisplayStatus(status, ticket.dueAt, now),
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assignee?.name ?? null,
    dueAt: ticket.dueAt?.toISOString() ?? null,
  };
}

const detailInclude = {
  creator: { select: { name: true } },
  assignee: { select: { name: true } },
  // id/active ride along for the edit form: a disabled current value stays
  // selectable (labelled 已停用) while other disabled options never appear
  category: { select: { id: true, name: true, active: true } },
  channel: { select: { id: true, name: true, active: true } },
  // 完结状态 is display-only on the detail page — the CURRENT name suffices
  completionStatus: { select: { name: true } },
  processLogs: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.TicketInclude;

type TicketWithDetail = Prisma.TicketGetPayload<{ include: typeof detailInclude }>;

/**
 * Full ticket detail + timeline for the detail page. Applies the RBAC data
 * scope (no `ticket.view_all` → only tickets assigned to or created by the
 * viewer) and excludes soft-deleted rows; returns null when the ticket is
 * invisible to the viewer, which the router surfaces as NOT_FOUND (existence
 * is not leaked).
 */
export async function getTicketDetail(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  ticketId: string,
) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, deletedAt: null, ...applyTicketDataScope(viewer) },
    include: detailInclude,
  });
  return ticket === null ? null : serializeTicketDetail(ticket, clock.now());
}

/**
 * Wire shape for the web app: dates as ISO-8601 strings (no transformer on the
 * tRPC link), plus the read-time derivations — createdBy and the computed
 * display status.
 */
function serializeTicketDetail(ticket: TicketWithDetail, now: Date) {
  // Re-narrow the String columns through the shared schemas so the wire type
  // carries the enum unions — the web renders without a single cast. Nullable
  // columns (未填写) pass null through untouched.
  const source = ticketSourceSchema.parse(ticket.source);
  const status = ticketStatusSchema.parse(ticket.status);
  const priority = parseNullable(prioritySchema, ticket.priority);

  return {
    id: ticket.id,
    workOrderNumber: ticket.workOrderNumber,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    feedbackTime: ticket.feedbackTime?.toISOString() ?? null,
    source,
    // 由谁创建 is derived at read time, never snapshotted onto the ticket:
    // creator-backed tickets show the creator's *current* name, external ones
    // the source label.
    createdBy: isCreatorBackedSource(source)
      ? (ticket.creator?.name ?? null)
      : TICKET_SOURCE_LABELS[source],
    channel: ticket.channel,
    project: ticket.project,
    brokerageEntity: ticket.brokerageEntity,
    paymentChannel: ticket.paymentChannel,
    internalOrderNumber: ticket.internalOrderNumber,
    policyNumbers: ticket.policyNumbers,
    userComplaintChannel: ticket.userComplaintChannel,
    complaintReceiveChannel: ticket.complaintReceiveChannel,
    customerName: ticket.customerName,
    phone: ticket.phone,
    contactPhone: ticket.contactPhone,
    customerRequest: ticket.customerRequest,
    nuclearBodyStatus: parseNullable(nuclearBodyStatusSchema, ticket.nuclearBodyStatus),
    hasContacted: ticket.hasContacted,
    contactTime: ticket.contactTime?.toISOString() ?? null,
    contactId: ticket.contactId,
    category: ticket.category,
    complaintLevel: parseNullable(complaintLevelSchema, ticket.complaintLevel),
    priority,
    followUpFrequency: ticket.followUpFrequency,
    firstResponseRequirement: ticket.firstResponseRequirement,
    status,
    displayStatus: deriveDisplayStatus(status, ticket.dueAt, now),
    assigneeId: ticket.assigneeId,
    // Current follow-up owner is derived via JOIN, never stored
    assigneeName: ticket.assignee?.name ?? null,
    assignedAt: ticket.assignedAt?.toISOString() ?? null,
    dueAt: ticket.dueAt?.toISOString() ?? null,
    nextContactTime: ticket.nextContactTime?.toISOString() ?? null,
    contactCount: ticket.contactCount,
    processingResult: ticket.processingResult,
    completionTime: ticket.completionTime?.toISOString() ?? null,
    completionStatus: ticket.completionStatus?.name ?? null,
    processLogs: ticket.processLogs.map((log) => ({
      id: log.id,
      operatorId: log.operatorId,
      operatorName: log.operatorName,
      operatorAvatar: log.operatorAvatar,
      action: processLogActionSchema.parse(log.action),
      from: log.from,
      to: log.to,
      remark: log.remark,
      at: log.at.toISOString(),
    })),
  };
}
