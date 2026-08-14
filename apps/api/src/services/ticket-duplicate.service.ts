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

/** 保单号只会是数字+字母；「无」「无保单信息」等占位值不参与查重，否则无保单客户互相误报。 */
const MATCHABLE_POLICY_NUMBER = /^[0-9A-Za-z]+$/;

/** 命中字段按输入侧命名：row 的哪个取值撞了 query 的哪个字段。 */
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
      // 条目活动摘要＝最新一条 resolve/comment/external_note 留痕。完结单的沟通
      // 止于 resolve（完结后不可再跟进/留言），故完结单取到的必是完结备注
      processLogs: {
        select: { at: true, remark: true },
        where: { action: { in: ["resolve", "comment", "external_note"] } },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: 1,
      },
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
    matchedFields: matchedFieldsOf(row, query, policyNumbers),
    activityAt: (row.processLogs[0]?.at ?? row.createdAt).toISOString(),
    activityText: row.processLogs[0]?.remark ?? "暂无处理记录",
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
