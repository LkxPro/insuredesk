import {
  TICKET_SOURCE_LABELS,
  type TicketCreateData,
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
