import type { TicketAddRelatedNoteData, TicketRelatedMatch } from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";
import {
  findDuplicateTickets,
  type TicketDuplicateDeps,
  ticketMatchWhere,
} from "./ticket-duplicate.service.ts";

export function relatedTicketScope(actor: AuthenticatedUser): Prisma.TicketWhereInput {
  if (actor.isExternal || !actor.permissions.includes("ticket.create")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无内部工单录入权限" });
  }
  return {
    deletedAt: null,
    status: { not: "completed" },
    ...(!actor.permissions.includes("ticket.relate_all") ? applyTicketDataScope(actor) : {}),
  };
}

export function relatedTicketWhere(
  actor: AuthenticatedUser,
  match: TicketRelatedMatch,
): Prisma.TicketWhereInput {
  return { AND: [relatedTicketScope(actor), ticketMatchWhere(match)] };
}

export function findRelatedTickets(
  deps: TicketDuplicateDeps,
  actor: AuthenticatedUser,
  match: TicketRelatedMatch,
) {
  return findDuplicateTickets(deps, match, undefined, relatedTicketScope(actor));
}

export async function lockRelatedTicketMatch(
  tx: Prisma.TransactionClient,
  match: TicketRelatedMatch,
) {
  const keys = [
    ...match.policyNumbers
      .filter((value) => /^[0-9A-Za-z]+$/.test(value))
      .map((value) => `policy:${value}`),
    ...[match.phone, match.contactPhone]
      .filter((value) => value !== null)
      .map((value) => `phone:${value}`),
  ];
  // 两种电话共用锁键；统一排序避免多字段并发录入互锁。
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

export async function addRelatedTicketNote(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketAddRelatedNoteData,
) {
  const where = { id: input.ticketId, ...relatedTicketWhere(actor, input.match) };
  return prisma.$transaction(async (tx) => {
    const now = clock.now();
    // 等待编辑锁后必须用新语句快照重验明细，避免按旧电话或保单追加。
    await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${input.ticketId} FOR UPDATE`;
    const updated = await tx.ticket.updateMany({ where, data: { updatedAt: now } });
    if (updated.count === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "工单已完结、已删除或不再符合关联权限和条件，请重新查询",
      });
    }
    await tx.processLog.create({
      data: {
        ticketId: input.ticketId,
        operatorId: actor.id,
        operatorName: actor.name,
        action: "internal_note",
        remark: input.remark,
        internalOnly: true,
        at: now,
      },
    });
    return { id: input.ticketId };
  });
}
