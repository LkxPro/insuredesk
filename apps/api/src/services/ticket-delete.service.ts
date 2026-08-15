import type { TicketDeleteInput } from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";
import { TicketNotFoundError } from "./ticket-assign.service.ts";

/**
 * Soft-delete domain logic: the dangerous ticket.delete
 * operation. Stamps deletedAt and nothing else — no physical delete, no
 * ProcessLog entry (the action enum is closed and 删除 is not in it; the
 * existing logs and attachments stay behind the tombstone, 可追溯).
 *
 * The exclusion side needs no code here: every default read — list, detail,
 * the other lifecycle actions, and any statistics — already filters
 * deletedAt = null, so a deleted ticket drops out of all of them the moment
 * this commits. 本期只删不恢复: no restore path exists (DBA-only).
 */

/**
 * Soft-delete one ticket, any status. Guarded upstream by ticket.delete; the
 * lookup carries the viewer data scope, so a deleter without ticket.view_all
 * stays on their own tickets — anything else (unknown id, already deleted,
 * out of scope) surfaces as not-found, with no existence leak.
 */
export async function deleteTicket(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketDeleteInput,
) {
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      select: { id: true, workOrderNumber: true },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    // Conditional write: a concurrent delete that committed first leaves zero
    // rows to claim — same not-found as if we'd never seen the ticket.
    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, deletedAt: null },
      data: { deletedAt: now },
    });
    if (count === 0) {
      throw new TicketNotFoundError();
    }

    return { id: ticket.id, workOrderNumber: ticket.workOrderNumber };
  });
}
