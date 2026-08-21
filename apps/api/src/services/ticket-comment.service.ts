import { type TicketAddCommentData, TicketStatus, ticketStatusSchema } from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";
import {
  buildExternalReplyNotification,
  writeExternalCreatorNotification,
} from "./notification.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";
import { TicketNotFoundError } from "./ticket-assign.service.ts";

/**
 * Follow-up domain logic: 添加跟进备注 = one actual customer contact.
 *
 * Invariants enforced here:
 * - contactCount / nextContactTime change ONLY through this action (单点维护):
 *   count +1, and nextContactTime is rewritten wholesale — an omitted value
 *   clears the previous follow-up's plan rather than leaving a stale past time
 *   behind
 * - the follow-up itself lands solely as a comment ProcessLog; the timeline is
 *   its only surface, no snapshot column on the ticket
 * - the FIRST follow-up moves assigned → processing, with the mandatory
 *   separate status_change log entry; because that transition fires
 *   on every comment while still assigned, a 改派 before any follow-up changes
 *   nothing — the new assignee's first comment still triggers it
 * - dueAt / assignedAt are never touched
 */

export class TicketNotProcessableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketNotProcessableError";
  }

  static unassigned(workOrderNumber: string) {
    return new TicketNotProcessableError(`工单 ${workOrderNumber} 尚未分配责任人，不能添加跟进`);
  }

  static completed(workOrderNumber: string) {
    return new TicketNotProcessableError(`工单 ${workOrderNumber} 已完结，不能再添加跟进`);
  }
}

/**
 * Add one follow-up record. Guarded upstream by ticket.process; the lookup
 * carries the viewer data scope, so a frontline CS (no ticket.view_all) can
 * only follow up on their own tickets — anything else surfaces as not-found
 * (no existence leak). WHO may act is decided entirely by permission + scope:
 * a supervisor with ticket.view_all may follow up on others' tickets (顶班).
 */
export async function addTicketComment(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketAddCommentData,
) {
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      select: { id: true, workOrderNumber: true, status: true, source: true, creatorId: true },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }
    if (ticket.status === TicketStatus.Unassigned) {
      throw TicketNotProcessableError.unassigned(ticket.workOrderNumber);
    }
    if (ticket.status === TicketStatus.Completed) {
      throw TicketNotProcessableError.completed(ticket.workOrderNumber);
    }

    // 首次跟进 ⟺ still assigned: comments are the only way out of assigned,
    // so an assigned ticket by definition has no prior follow-up
    const isFirstFollowUp = ticket.status === TicketStatus.Assigned;
    const status = isFirstFollowUp
      ? TicketStatus.Processing
      : ticketStatusSchema.parse(ticket.status);

    // Claim the transition with a conditional write, not the read above: two
    // concurrent first follow-ups would both have read `assigned`, but only
    // the claimer may write the status_change entry — the loser's comment is
    // a "subsequent" one (仅写一条 comment)
    const claimedTransition =
      isFirstFollowUp &&
      (
        await tx.ticket.updateMany({
          where: { id: ticket.id, status: TicketStatus.Assigned },
          data: { status: TicketStatus.Processing },
        })
      ).count === 1;

    const { contactCount } = await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        contactCount: { increment: 1 },
        nextContactTime: input.nextContactTime ? new Date(input.nextContactTime) : null,
      },
      select: { contactCount: true },
    });

    const operator = {
      ticketId: ticket.id,
      operatorId: actor.id,
      operatorName: actor.name,
      at: now,
    };

    await tx.processLog.create({
      data: {
        ...operator,
        action: "comment",
        remark: input.remark,
        internalOnly: input.internalOnly,
      },
    });

    if (claimedTransition) {
      // 状态变更一律独立记录: the transition gets its own entry,
      // created after the comment log so the timeline reads cause → effect
      await tx.processLog.create({
        data: {
          ...operator,
          action: "status_change",
          from: TicketStatus.Assigned,
          to: TicketStatus.Processing,
          remark: "首次跟进",
        },
      });
    }

    // 内部跟进的回执只发给外部提交者；internalOnly 外部不可见，不发
    if (!input.internalOnly) {
      await writeExternalCreatorNotification(tx, {
        ticket,
        ...buildExternalReplyNotification({
          operatorName: actor.name,
          workOrderNumber: ticket.workOrderNumber,
        }),
        now,
      });
    }

    return { id: ticket.id, workOrderNumber: ticket.workOrderNumber, status, contactCount };
  });
}
