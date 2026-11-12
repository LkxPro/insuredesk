import {
  isRefundCallbackSuppressed,
  TicketKindKey,
  type TicketResolveInput,
  TicketStatus,
} from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service.ts";
import { createRefundCallbackDelivery } from "./callback-delivery.service.ts";
import { completionStatusCatalog } from "./completion-status.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";
import {
  buildExternalResolvedNotification,
  writeExternalCreatorNotification,
} from "./notification.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";
import { TicketNotFoundError } from "./ticket-assign.service.ts";

/**
 * - only assigned / processing tickets can resolve; completed is a 终态 —
 *   no reopen path exists anywhere (状态只能经生命周期动作流转)
 * - completionTime / completionStatusId are written ONLY by this action, in
 *   the same instant as the resolve + status_change ProcessLog pair
 * - completed tickets must not appear in pending_timeout / overdue or 我的待办 alarms
 * - dueAt / assignedAt / contactCount are never touched
 */

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

export async function resolveTicket(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketResolveInput,
) {
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      select: {
        id: true,
        workOrderNumber: true,
        status: true,
        source: true,
        creatorId: true,
        kind: { select: { key: true } },
      },
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

    const completionStatus = await completionStatusCatalog.resolveNewRef(
      tx,
      input.completionStatusId,
    );

    const claim = (status: TicketStatus) =>
      tx.ticket.updateMany({
        where: { id: ticket.id, status },
        data: {
          status: TicketStatus.Completed,
          completionTime: now,
          completionStatusId: completionStatus.id,
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
    const suppressCallback = isRefundCallbackSuppressed(ticket.source, completionStatus.id);

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
        remark: suppressCallback ? "确认完结；未退费结案，不回传弘樊" : "确认完结",
      },
    });

    await writeExternalCreatorNotification(tx, {
      ticket,
      ...buildExternalResolvedNotification({ workOrderNumber: ticket.workOrderNumber }),
      now,
    });

    if (ticket.kind.key === TicketKindKey.RefundException && !suppressCallback) {
      await createRefundCallbackDelivery(tx, {
        ticket,
        operatorUsername: actor.username,
        remark: input.remark,
      });
    }

    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      status: TicketStatus.Completed,
      completionStatus: completionStatus.name,
    };
  });
}
