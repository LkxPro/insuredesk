import { type TicketResolveInput, TicketStatus } from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service";
import { applyTicketDataScope } from "./data-scope.service";
import { TicketNotFoundError } from "./ticket-assign.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * Resolve domain logic: 完结工单 with a mandatory completionStatus
 * (12 种封闭枚举) and a 完结备注. Pure service layer — the router maps the
 * domain errors to transport codes.
 *
 * Invariants enforced here:
 * - only assigned / processing tickets can resolve; completed is a 终态 —
 *   no reopen path exists anywhere (状态只能经生命周期动作流转)
 * - completionTime / completionStatus are written ONLY by this action, in the
 *   same instant as the resolve + status_change ProcessLog pair
 * - the resolved ticket leaves the pending_timeout / overdue 实时运营口径 by
 *   construction: those predicates exclude status = completed, and
 *   the read-time 我的待办 alarms stop with them — nothing else to
 *   flip here
 * - dueAt / assignedAt / contactCount are never touched
 */

/** Ticket visible but its state does not accept a resolve. */
export class TicketNotResolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketNotResolvableError";
  }

  static unassigned(workOrderNumber: string) {
    return new TicketNotResolvableError(`工单 ${workOrderNumber} 尚未分配责任人，不能完结`);
  }

  static completed(workOrderNumber: string) {
    return new TicketNotResolvableError(`工单 ${workOrderNumber} 已完结，不能重复完结`);
  }
}

/**
 * Resolve one ticket. Guarded upstream by ticket.process; the lookup carries
 * the viewer data scope, so a frontline CS (no ticket.view_all) can only
 * resolve their own tickets — anything else surfaces as not-found (no
 * existence leak). A supervisor with ticket.view_all may resolve others'
 * tickets (顶班), same as follow-ups.
 */
export async function resolveTicket(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketResolveInput,
) {
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      select: { id: true, workOrderNumber: true, status: true },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }
    if (ticket.status === TicketStatus.Unassigned) {
      throw TicketNotResolvableError.unassigned(ticket.workOrderNumber);
    }
    if (ticket.status === TicketStatus.Completed) {
      throw TicketNotResolvableError.completed(ticket.workOrderNumber);
    }

    // Claim the 终态 with a conditional write on the EXACT status we read, so
    // the status_change log's `from` is the true prior state. Statuses only
    // move forward (assigned → processing → completed), so losing the claim
    // means either a concurrent first follow-up slipped in (retry once on
    // processing) or a concurrent resolve won (终态 — reject).
    const claim = (status: TicketStatus) =>
      tx.ticket.updateMany({
        where: { id: ticket.id, status },
        data: {
          status: TicketStatus.Completed,
          completionTime: now,
          completionStatus: input.completionStatus,
        },
      });

    let from: TicketStatus =
      ticket.status === TicketStatus.Assigned ? TicketStatus.Assigned : TicketStatus.Processing;
    if ((await claim(from)).count === 0) {
      if (from !== TicketStatus.Assigned || (await claim(TicketStatus.Processing)).count === 0) {
        throw TicketNotResolvableError.completed(ticket.workOrderNumber);
      }
      from = TicketStatus.Processing;
    }

    const operator = {
      ticketId: ticket.id,
      operatorId: actor.id,
      operatorName: actor.name,
      at: now,
    };

    await tx.processLog.create({
      data: { ...operator, action: "resolve", remark: input.remark },
    });

    // 状态变更一律独立记录: the transition gets its own entry,
    // created after the resolve log so the timeline reads cause → effect
    await tx.processLog.create({
      data: {
        ...operator,
        action: "status_change",
        from,
        to: TicketStatus.Completed,
        remark: "确认完结",
      },
    });

    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      status: TicketStatus.Completed,
      completionStatus: input.completionStatus,
    };
  });
}
