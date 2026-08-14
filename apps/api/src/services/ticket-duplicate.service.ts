import {
  deriveDisplayStatus,
  TICKET_DUPLICATES_LIMIT,
  type TicketDuplicateMatchField,
  type TicketFindDuplicatesQuery,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Clock } from "../clock";
import type { Prisma, PrismaClient } from "../generated/prisma/client";

/**
 * 建单/编辑查重：对全部未软删工单做保单号 + 手机号精确匹配。
 *
 * 数据范围故意不加 applyTicketDataScope —— 查重的价值恰恰在于看见别的客服
 * 名下的工单，收窄到「指派给我/我创建」会让重复单恰恰漏掉。权限边界在路由层
 * （ticket.view），本模块返回的最小字段集即全部暴露面。
 */

export interface TicketDuplicateDeps {
  prisma: Pick<PrismaClient, "ticket">;
  clock: Clock;
}

/** 提交兜底查重命中；路由映射 409，重复列表由前端经 findDuplicates 重取。 */
export class DuplicateTicketsFoundError extends Error {
  constructor(public readonly count: number) {
    super(`发现 ${count} 个可能重复的工单`);
    this.name = "DuplicateTicketsFoundError";
  }
}

type CandidateRow = {
  policyNumbers: string[];
  phone: string | null;
  contactPhone: string | null;
};

/** 命中字段按输入侧命名：row 的哪个取值撞了 query 的哪个字段。 */
function matchedFieldsOf(
  row: CandidateRow,
  query: TicketFindDuplicatesQuery,
): TicketDuplicateMatchField[] {
  const fields: TicketDuplicateMatchField[] = [];
  if (row.policyNumbers.some((value) => query.policyNumbers.includes(value))) {
    fields.push("policyNumbers");
  }
  if (query.phone !== null && (row.phone === query.phone || row.contactPhone === query.phone)) {
    fields.push("phone");
  }
  if (
    query.contactPhone !== null &&
    (row.phone === query.contactPhone || row.contactPhone === query.contactPhone)
  ) {
    fields.push("contactPhone");
  }
  return fields;
}

export async function findDuplicateTickets(
  { prisma, clock }: TicketDuplicateDeps,
  query: TicketFindDuplicatesQuery,
) {
  const phones = [query.phone, query.contactPhone].filter(
    (value): value is string => value !== null,
  );
  const branches: Prisma.TicketWhereInput[] = [];
  if (query.policyNumbers.length > 0) {
    branches.push({ policyNumbers: { hasSome: query.policyNumbers } });
  }
  if (phones.length > 0) {
    branches.push({ phone: { in: phones } }, { contactPhone: { in: phones } });
  }
  if (branches.length === 0) {
    return [];
  }

  const rows = await prisma.ticket.findMany({
    where: {
      deletedAt: null,
      ...(query.excludeTicketId ? { id: { not: query.excludeTicketId } } : {}),
      OR: branches,
    },
    select: {
      id: true,
      workOrderNumber: true,
      status: true,
      dueAt: true,
      customerName: true,
      createdAt: true,
      policyNumbers: true,
      phone: true,
      contactPhone: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TICKET_DUPLICATES_LIMIT,
  });

  const now = clock.now();
  return rows.map((row) => ({
    id: row.id,
    workOrderNumber: row.workOrderNumber,
    customerName: row.customerName,
    createdAt: row.createdAt.toISOString(),
    displayStatus: deriveDisplayStatus(ticketStatusSchema.parse(row.status), row.dueAt, now),
    matchedFields: matchedFieldsOf(row, query),
  }));
}

/** 提交兜底：命中即抛 DuplicateTicketsFoundError。 */
export async function assertNoDuplicateTickets(
  deps: TicketDuplicateDeps,
  query: TicketFindDuplicatesQuery,
): Promise<void> {
  const duplicates = await findDuplicateTickets(deps, query);
  if (duplicates.length > 0) {
    throw new DuplicateTicketsFoundError(duplicates.length);
  }
}
