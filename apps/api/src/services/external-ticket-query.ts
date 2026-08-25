import {
  substringSearchPattern,
  type TicketListFilterParams,
  ticketListFilterConditions,
} from "@insuredesk/shared";
import { Prisma } from "../generated/prisma/client.ts";

/**
 * 外部工单列表/导出共用的 WHERE 条件（raw SQL 片段）。两个口子吃同一份构造器，
 * 筛选口径不可能分叉——与内部列表/导出共享 buildTicketListWhere 同理。
 * 片段内表别名固定为 t，调用方的查询必须把 tickets 别名为 t。
 */
export function buildExternalTicketConditions(
  userId: string,
  input: TicketListFilterParams,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`t."creatorId" = ${userId}`,
    Prisma.sql`t."deletedAt" IS NULL`,
  ];
  for (const condition of ticketListFilterConditions(input)) {
    switch (condition.kind) {
      case "statusIn":
        conditions.push(Prisma.sql`t.status IN (${Prisma.join(condition.statuses)})`);
        break;
      case "kindIn":
        conditions.push(Prisma.sql`t."kindId" IN (${Prisma.join(condition.kindIds)})`);
        break;
      case "search": {
        const pattern = substringSearchPattern(condition.term);
        conditions.push(
          Prisma.sql`(t."workOrderNumber" ILIKE ${pattern} OR t."submissionText" ILIKE ${pattern} OR array_to_string(t."policyNumbers", ' ') ILIKE ${pattern})`,
        );
        break;
      }
      case "createdAtRange":
        if (condition.gte !== undefined) {
          conditions.push(Prisma.sql`t."createdAt" >= ${condition.gte}`);
        }
        if (condition.lte !== undefined) {
          conditions.push(Prisma.sql`t."createdAt" <= ${condition.lte}`);
        }
        break;
    }
  }
  return conditions;
}
