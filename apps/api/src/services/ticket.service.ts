import {
  TICKET_SOURCE_LABELS,
  type TicketCreateData,
  type TicketListQuery,
  TicketStatus,
  deriveDisplayStatus,
  formatFirstResponseRequirement,
  formatFollowUpFrequency,
  prioritySchema,
  processLogActionSchema,
  reminderRulesSchema,
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

const HOUR_MS = 60 * 60 * 1000;

/**
 * Create a manually-entered ticket (PRD §3.1, §9.2, §9.3):
 *
 * - workOrderNumber comes from the Postgres sequence default (concurrency-safe)
 * - dueAt is fixed once, here: createdAt + the level's SLA overdueHours
 *   (null for 特急 — never overdue)
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
  const policy = await prisma.slaPolicy.findUnique({
    where: { complaintLevel: input.complaintLevel },
  });
  if (!policy) {
    throw new SlaPolicyNotConfiguredError(input.complaintLevel);
  }
  const reminderRules = reminderRulesSchema.parse(policy.reminderRules);

  // One instant for createdAt, dueAt, and the log entry, taken from the
  // injectable clock (ADR 0006) — dueAt is exactly createdAt + overdueHours.
  const now = clock.now();
  const dueAt =
    policy.overdueHours === null ? null : new Date(now.getTime() + policy.overdueHours * HOUR_MS);

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        ...input,
        feedbackTime: new Date(input.feedbackTime),
        createdAt: now,
        source: "manual",
        creatorId: creator.id,
        status: TicketStatus.Unassigned,
        dueAt,
        followUpFrequency: formatFollowUpFrequency(reminderRules),
        firstResponseRequirement: formatFirstResponseRequirement(policy.firstResponseMinutes),
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

/**
 * Paged ticket list for 工单管理 (issue #23). Applies, in one WHERE:
 *
 * - soft-delete exclusion (deletedAt null, PRD §4.5)
 * - the RBAC data scope — no `ticket.view_all` → only own tickets, so the
 *   unassigned pool never reaches 一线客服 (PRD §5.2)
 * - the filters, with computed statuses resolved through the single-truth
 *   predicate module (ADR 0001) rather than restated here
 *
 * One `clock.now()` serves the whole request, so the rows a computed-status
 * filter selects and the displayStatus they serialize with can never disagree.
 */
export async function listTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: TicketListQuery,
) {
  const now = clock.now();

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

  const where: Prisma.TicketWhereInput = {
    deletedAt: null,
    ...applyTicketDataScope(viewer),
    AND: filters,
  };

  // dueAt is nullable (特急 has none): those rows sort last either direction —
  // "no deadline" is never "most urgent"
  const orderBy: Prisma.TicketOrderByWithRelationInput =
    query.sortBy === "dueAt"
      ? { dueAt: { sort: query.sortOrder, nulls: "last" } }
      : { createdAt: query.sortOrder };

  const [rows, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      include: listInclude,
      // id breaks ordering ties so pagination never skips or repeats a row
      orderBy: [orderBy, { id: "desc" }],
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

/** Wire shape of one list row — the list's columns, nothing more. */
function serializeTicketListItem(ticket: TicketListRow, now: Date) {
  const source = ticketSourceSchema.parse(ticket.source);
  const status = ticketStatusSchema.parse(ticket.status);

  return {
    id: ticket.id,
    workOrderNumber: ticket.workOrderNumber,
    createdAt: ticket.createdAt.toISOString(),
    source,
    channel: ticket.channel,
    category: ticket.category,
    complaintLevel: ticket.complaintLevel,
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
  // carries the enum unions — the web renders without a single cast.
  const source = ticketSourceSchema.parse(ticket.source);
  const status = ticketStatusSchema.parse(ticket.status);
  const priority = ticket.priority === null ? null : prioritySchema.parse(ticket.priority);

  return {
    id: ticket.id,
    workOrderNumber: ticket.workOrderNumber,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    feedbackTime: ticket.feedbackTime.toISOString(),
    source,
    // 由谁创建 is derived at read time, never snapshotted onto the ticket:
    // internal tickets show the creator's *current* name, external ones the
    // source label (PRD §3.1.8).
    createdBy: source === "manual" ? (ticket.creator?.name ?? null) : TICKET_SOURCE_LABELS[source],
    channel: ticket.channel,
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
    nuclearBodyStatus: ticket.nuclearBodyStatus,
    hasContacted: ticket.hasContacted,
    contactId: ticket.contactId,
    category: ticket.category,
    complaintLevel: ticket.complaintLevel,
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
