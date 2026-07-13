import {
  TICKET_SOURCE_LABELS,
  type TicketCreateData,
  type TicketListQuery,
  TicketStatus,
  channelSchema,
  complaintLevelSchema,
  deriveDisplayStatus,
  deriveDueAt,
  formatFirstResponseRequirement,
  formatFollowUpFrequency,
  normalizeReminderRules,
  nuclearBodyStatusSchema,
  prioritySchema,
  processLogActionSchema,
  ticketCategorySchema,
  ticketSourceSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Clock } from "../clock";
import type { AuthenticatedUser } from "./auth.service";
import { applyTicketDataScope } from "./data-scope.service";
import { displayStatusTicketWhere } from "./ticket-display-status";

/**
 * Ticket domain logic (issue #22): manual creation and detail reads. Pure
 * service layer per ADR 0006 — no tRPC/HTTP types; the router maps domain
 * errors to transport codes.
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

/**
 * The SLA fields a complaintLevel stamps onto a ticket, derived and described
 * by the rule-engine off the level's policy row (issue #47) — this adapter
 * only owns the database read. A null level (未定级, issue #43) stamps
 * all-null: no dueAt, no 首响/跟进 requirements — and hence no SLA time
 * alerts until an edit sets a level (off the original createdAt).
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
    // THE dueAt formula (PRD §9.2): createdAt + the level's overdueHours,
    // null for 特急 (no deadline). Creation stamps it; a complaintLevel edit
    // re-runs it with the new level's hours against the same unchanging
    // createdAt (PRD §4.5).
    dueAt: deriveDueAt(createdAt, policy.overdueHours),
    followUpFrequency: formatFollowUpFrequency(normalizeReminderRules(policy.reminderRules)),
    firstResponseRequirement: formatFirstResponseRequirement(policy.firstResponseMinutes),
  };
}

/**
 * Create a manually-entered ticket (PRD §3.1, §9.2, §9.3):
 *
 * - every user field is optional (issue #43): a fully blank submission is
 *   valid, unfilled fields persist as NULL ("unknown", never "")
 * - workOrderNumber comes from the Postgres sequence default (concurrency-safe)
 * - dueAt is fixed once, here: createdAt + the level's SLA overdueHours
 *   (null for 特急 — never overdue; null while 未定级 — no SLA clock fields)
 * - 跟进频次/首响要求 are stamped from the level's SLA config, not hardcoded
 * - source=manual records creatorId; "由谁创建" derives at read time (§3.1.8)
 * - the first `create` ProcessLog (operator name snapshot) lands in the same
 *   transaction, so a ticket can never exist without its timeline root
 */
export async function createTicket(
  { prisma, clock }: TicketServiceDeps,
  creator: AuthenticatedUser,
  input: TicketCreateData,
) {
  // One instant for createdAt, dueAt, and the log entry, taken from the
  // injectable clock (ADR 0006) — dueAt is exactly createdAt + overdueHours.
  const now = clock.now();
  const slaStamp = await computeSlaStamp(prisma, input.complaintLevel, now);

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        ...input,
        feedbackTime: input.feedbackTime === null ? null : new Date(input.feedbackTime),
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
        // Name snapshot on purpose (PRD §3.2): the timeline shows who it was
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
  // Current follow-up owner is derived via JOIN, never stored (CONTEXT.md "Follower")
  assignee: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type TicketListRow = Prisma.TicketGetPayload<{ include: typeof listInclude }>;

/** The list's filter/sort subset — shared verbatim by the export (issue #34). */
type TicketListFilters = Pick<
  TicketListQuery,
  "status" | "channel" | "complaintLevel" | "source" | "search" | "sortBy" | "sortOrder"
>;

/**
 * The ONE WHERE for "what this viewer's filtered list contains" — shared by
 * the paged list and the export so the two can never disagree (issue #34
 * 筛选条件与导出内容一致 by construction). Applies:
 *
 * - soft-delete exclusion (deletedAt null, PRD §4.5)
 * - the RBAC data scope — no `ticket.view_all` → only own tickets, so the
 *   unassigned pool never reaches 一线客服 (PRD §5.2)
 * - the filters, with computed statuses resolved through the single-truth
 *   predicate module (ADR 0001) rather than restated here
 */
export function buildTicketListWhere(
  viewer: AuthenticatedUser,
  query: TicketListFilters,
  now: Date,
): Prisma.TicketWhereInput {
  // Each filter is its own AND element so their inner ORs (base-status
  // predicate, search) can never collide.
  const filters: Prisma.TicketWhereInput[] = [];
  if (query.status) {
    filters.push(displayStatusTicketWhere(query.status, now));
  }
  if (query.channel) {
    filters.push({ channel: query.channel });
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
        { policyNumber: { contains: query.search, mode: "insensitive" } },
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
 * Paged ticket list for 工单管理 (issue #23): the shared WHERE/ORDER above,
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
  const where = buildTicketListWhere(viewer, query, now);

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
    channel: parseNullable(channelSchema, ticket.channel),
    category: parseNullable(ticketCategorySchema, ticket.category),
    complaintLevel: parseNullable(complaintLevelSchema, ticket.complaintLevel),
    customerName: ticket.customerName,
    policyNumber: ticket.policyNumber,
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
  processLogs: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.TicketInclude;

type TicketWithDetail = Prisma.TicketGetPayload<{ include: typeof detailInclude }>;

/**
 * Full ticket detail + timeline for the detail page. Applies the RBAC data
 * scope (no `ticket.view_all` → only own tickets) and excludes soft-deleted
 * rows; returns null when the ticket is invisible to the viewer, which the
 * router surfaces as NOT_FOUND (existence is not leaked).
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
 * tRPC link), plus the read-time derivations — createdBy (PRD §3.1.8) and the
 * computed display status (PRD §3.1.6).
 */
function serializeTicketDetail(ticket: TicketWithDetail, now: Date) {
  // Re-narrow the String columns through the shared schemas so the wire type
  // carries the enum unions — the web renders without a single cast. Nullable
  // columns (未填写, issue #43) pass null through untouched.
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
    // internal tickets show the creator's *current* name, external ones the
    // source label (PRD §3.1.8).
    createdBy: source === "manual" ? (ticket.creator?.name ?? null) : TICKET_SOURCE_LABELS[source],
    channel: parseNullable(channelSchema, ticket.channel),
    project: ticket.project,
    brokerageEntity: ticket.brokerageEntity,
    paymentChannel: ticket.paymentChannel,
    internalOrderNumber: ticket.internalOrderNumber,
    policyNumber: ticket.policyNumber,
    userComplaintChannel: ticket.userComplaintChannel,
    customerName: ticket.customerName,
    phone: ticket.phone,
    contactPhone: ticket.contactPhone,
    customerRequest: ticket.customerRequest,
    nuclearBodyStatus: parseNullable(nuclearBodyStatusSchema, ticket.nuclearBodyStatus),
    hasContacted: ticket.hasContacted,
    contactId: ticket.contactId,
    category: parseNullable(ticketCategorySchema, ticket.category),
    complaintLevel: parseNullable(complaintLevelSchema, ticket.complaintLevel),
    priority,
    followUpFrequency: ticket.followUpFrequency,
    firstResponseRequirement: ticket.firstResponseRequirement,
    status,
    displayStatus: deriveDisplayStatus(status, ticket.dueAt, now),
    assigneeId: ticket.assigneeId,
    // Current follow-up owner is derived via JOIN, never stored (CONTEXT.md "Follower")
    assigneeName: ticket.assignee?.name ?? null,
    assignedAt: ticket.assignedAt?.toISOString() ?? null,
    dueAt: ticket.dueAt?.toISOString() ?? null,
    nextContactTime: ticket.nextContactTime?.toISOString() ?? null,
    contactCount: ticket.contactCount,
    processingResult: ticket.processingResult,
    completionTime: ticket.completionTime?.toISOString() ?? null,
    completionStatus: ticket.completionStatus,
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
