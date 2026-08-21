import {
  deriveDisplayStatus,
  TICKET_DUPLICATES_LIMIT,
  type TicketDuplicateMatchField,
  type TicketFindDuplicatesQuery,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Clock } from "../clock.ts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

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

export class DuplicateTicketsFoundError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(`发现 ${count} 个可能重复的工单`);
    this.name = "DuplicateTicketsFoundError";
    this.count = count;
  }
}

type CandidateRow = {
  policyNumbers: string[];
  phone: string | null;
  contactPhone: string | null;
};

/** 保单号只会是数字+字母；「无」「无保单信息」等占位值不参与查重，否则无保单客户互相误报。 */
const MATCHABLE_POLICY_NUMBER = /^[0-9A-Za-z]+$/;

function matchedFieldsOf(
  row: CandidateRow,
  query: TicketFindDuplicatesQuery,
  policyNumbers: string[],
): TicketDuplicateMatchField[] {
  const fields: TicketDuplicateMatchField[] = [];
  if (row.policyNumbers.some((value) => policyNumbers.includes(value))) {
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
  const policyNumbers = query.policyNumbers.filter((value) => MATCHABLE_POLICY_NUMBER.test(value));
  const phones = [query.phone, query.contactPhone].filter(
    (value): value is string => value !== null,
  );
  const branches: Prisma.TicketWhereInput[] = [];
  if (policyNumbers.length > 0) {
    branches.push({ policyNumbers: { hasSome: policyNumbers } });
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
      // 完结单的沟通止于 resolve（完结后不可再跟进/留言），取到的必是完结备注
      processLogs: {
        select: { at: true, remark: true },
        where: { action: { in: ["resolve", "comment", "external_note"] } },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });

  const now = clock.now();
  const mapped = rows.map((row) => ({
    id: row.id,
    workOrderNumber: row.workOrderNumber,
    customerName: row.customerName,
    createdAt: row.createdAt,
    displayStatus: deriveDisplayStatus(ticketStatusSchema.parse(row.status), row.dueAt, now),
    matchedFields: matchedFieldsOf(row, query, policyNumbers),
    activityAt: row.processLogs[0]?.at ?? row.createdAt,
    activityText: row.processLogs[0]?.remark ?? "暂无处理记录",
  }));
  // Prisma 无法按 take-1 关联排序，只能全量取出后在内存按展示时间排序、再截上限
  mapped.sort(
    (a, b) =>
      b.activityAt.getTime() - a.activityAt.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id.localeCompare(a.id),
  );
  return mapped.slice(0, TICKET_DUPLICATES_LIMIT).map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    activityAt: row.activityAt.toISOString(),
  }));
}

export async function assertNoDuplicateTickets(
  deps: TicketDuplicateDeps,
  query: TicketFindDuplicatesQuery,
): Promise<void> {
  const duplicates = await findDuplicateTickets(deps, query);
  if (duplicates.length > 0) {
    throw new DuplicateTicketsFoundError(duplicates.length);
  }
}
