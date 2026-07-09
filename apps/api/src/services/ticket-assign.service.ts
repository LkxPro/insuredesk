import {
  type TicketAssignInput,
  type TicketBatchAssignInput,
  TicketStatus,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { applyTicketDataScope } from "./data-scope.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * Assignment domain logic (issue #24, PRD §4.3): first assignment, 改派, and
 * 批量分配. Pure service layer per ADR 0006 — the router maps the domain
 * errors below to transport codes.
 *
 * Invariants enforced here:
 * - dueAt is never read or written — it is fixed at creation and assignment
 *   cannot move it (ADR 0002)
 * - assignedAt is stamped on FIRST assignment only; 改派 keeps it
 * - status moves only through this lifecycle action (unassigned → assigned),
 *   with the mandatory separate status_change log entry (PRD §3.2)
 */

/** Ticket invisible to the actor, soft-deleted, or plain missing. */
export class TicketNotFoundError extends Error {
  constructor() {
    super("工单不存在或无权查看");
    this.name = "TicketNotFoundError";
  }
}

/** Ticket visible but not assignable in its current state. */
export class TicketNotAssignableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketNotAssignableError";
  }

  static completed(workOrderNumber: string) {
    return new TicketNotAssignableError(`工单 ${workOrderNumber} 已完结，不能再分配`);
  }

  static alreadyAssigned(workOrderNumber: string, assigneeName: string) {
    return new TicketNotAssignableError(`工单 ${workOrderNumber} 已由「${assigneeName}」负责`);
  }
}

/** Target user missing or deactivated. */
export class AssigneeNotAssignableError extends Error {
  constructor() {
    super("所选责任人不存在或已停用");
    this.name = "AssigneeNotAssignableError";
  }
}

const assignmentInclude = {
  // Current assignee's name feeds the `from` snapshot of the assign log
  assignee: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type AssignableTicket = Prisma.TicketGetPayload<{ include: typeof assignmentInclude }>;

async function loadAssignee(tx: Prisma.TransactionClient, assigneeId: string) {
  const assignee = await tx.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, name: true, active: true },
  });
  if (!assignee?.active) {
    throw new AssigneeNotAssignableError();
  }
  return assignee;
}

/**
 * Core of both single and batch assignment: mutate one ticket and write its
 * ProcessLog entries. Runs inside the caller's transaction; `now` is shared so
 * every field and log entry of one action carries the same instant.
 *
 * Returns the ticket's status after the action.
 */
async function applyAssignment(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  ticket: AssignableTicket,
  assignee: { id: string; name: string },
  now: Date,
) {
  if (ticket.status === TicketStatus.Completed) {
    throw TicketNotAssignableError.completed(ticket.workOrderNumber);
  }
  if (ticket.assigneeId === assignee.id) {
    throw TicketNotAssignableError.alreadyAssigned(ticket.workOrderNumber, assignee.name);
  }

  const isFirstAssignment = ticket.assigneeId === null;

  await tx.ticket.update({
    where: { id: ticket.id },
    data: isFirstAssignment
      ? // 首次分配: enters the assignee's queue and leaves 未分配 — dueAt is
        // deliberately absent (ADR 0002)
        { assigneeId: assignee.id, assignedAt: now, status: TicketStatus.Assigned }
      : // 改派: only the owner changes; assignedAt keeps the FIRST assignment
        { assigneeId: assignee.id },
  });

  const operator = {
    ticketId: ticket.id,
    operatorId: actor.id,
    operatorName: actor.name,
    at: now,
  };

  // from/to are name snapshots (PRD §3.2): who it was at this moment, immune
  // to later renames. First assignment has no predecessor → from stays null.
  await tx.processLog.create({
    data: {
      ...operator,
      action: "assign",
      from: ticket.assignee?.name ?? null,
      to: assignee.name,
      remark: isFirstAssignment ? "分配工单" : "改派工单",
    },
  });

  if (isFirstAssignment) {
    // 状态变更一律独立记录 (PRD §3.2): the transition gets its own entry,
    // created after the assign log so the timeline reads cause → effect
    await tx.processLog.create({
      data: {
        ...operator,
        action: "status_change",
        from: ticket.status,
        to: TicketStatus.Assigned,
        remark: "分配工单",
      },
    });
    return TicketStatus.Assigned;
  }
  return ticketStatusSchema.parse(ticket.status);
}

/**
 * Assign or reassign one ticket (PRD §4.3 手动分配/改派). The lookup carries
 * the viewer data scope: an assigner without ticket.view_all can only act on
 * tickets they could see anyway, surfaced as not-found (no existence leak).
 */
export async function assignTicket(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketAssignInput,
) {
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    const assignee = await loadAssignee(tx, input.assigneeId);
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      include: assignmentInclude,
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    const status = await applyAssignment(tx, actor, ticket, assignee, now);
    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      status,
      assigneeName: assignee.name,
    };
  });
}

/**
 * 批量分配 (PRD §4.3): every selected ticket goes to the same assignee under
 * the single-assignment rules, in ONE transaction — a completed or invisible
 * ticket aborts the whole batch (a partial batch would leave an ambiguous
 * audit trail, and the error names the offending ticket so the operator can
 * deselect it). One deliberate deviation from the single rules: a ticket
 * already owned by the target is a no-op skip, not an error — the operator
 * picks the assignee only after selecting, so they cannot avoid including
 * such tickets, and "统一分配给同一责任人" is already true for them.
 */
export async function batchAssignTickets(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketBatchAssignInput,
) {
  const now = clock.now();
  // Dedupe defensively: a repeated id must not produce a duplicate log pair
  const ticketIds = [...new Set(input.ticketIds)];

  return prisma.$transaction(async (tx) => {
    const assignee = await loadAssignee(tx, input.assigneeId);
    const tickets = await tx.ticket.findMany({
      where: { id: { in: ticketIds }, deletedAt: null, ...applyTicketDataScope(actor) },
      include: assignmentInclude,
    });
    if (tickets.length !== ticketIds.length) {
      throw new TicketNotFoundError();
    }

    // Apply in the caller's selection order so failures are deterministic
    const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    let skippedCount = 0;
    for (const ticketId of ticketIds) {
      const ticket = byId.get(ticketId);
      if (!ticket) {
        throw new TicketNotFoundError();
      }
      if (ticket.assigneeId === assignee.id) {
        skippedCount += 1; // already the target's — nothing to change, no log
        continue;
      }
      await applyAssignment(tx, actor, ticket, assignee, now);
    }

    return {
      assignedCount: ticketIds.length - skippedCount,
      skippedCount,
      assigneeName: assignee.name,
    };
  });
}

/**
 * Users offered by the 责任人 picker: every active account. Deactivated users
 * stay assigned to their existing tickets but cannot receive new ones.
 */
export async function listAssigneeOptions({ prisma }: TicketServiceDeps) {
  return prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, username: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
