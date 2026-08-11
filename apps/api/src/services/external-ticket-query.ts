import { Prisma } from "../generated/prisma/client";

/**
 * 外部工单列表/导出共用的 WHERE 条件（raw SQL 片段）。两个口子吃同一份构造器，
 * 筛选口径不可能分叉——与内部列表/导出共享 buildTicketListWhere 同理。
 * 片段内表别名固定为 t，调用方的查询必须把 tickets 别名为 t。
 */
export function buildExternalTicketConditions(
  userId: string,
  input: {
    status?: readonly string[] | undefined;
    includeCompleted?: boolean;
    search?: string | undefined;
    createdFrom?: string | undefined;
    createdTo?: string | undefined;
  },
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`t."creatorId" = ${userId}`,
    Prisma.sql`t."deletedAt" IS NULL`,
  ];
  if (input.status && input.status.length > 0) {
    conditions.push(Prisma.sql`t.status IN (${Prisma.join(input.status)})`);
  } else if (!input.includeCompleted) {
    conditions.push(Prisma.sql`t.status <> 'completed'`);
  }
  if (input.search) {
    // 直接 %拼接%、不转义 LIKE 元字符——与内部列表各搜索支同款口径
    const pattern = `%${input.search}%`;
    conditions.push(
      Prisma.sql`(t."workOrderNumber" ILIKE ${pattern} OR t."submissionText" ILIKE ${pattern} OR array_to_string(t."policyNumbers", ' ') ILIKE ${pattern})`,
    );
  }
  // 创建时间区间左闭右闭；边界已是绝对时刻，日界口径由前端算定
  if (input.createdFrom !== undefined) {
    conditions.push(Prisma.sql`t."createdAt" >= ${new Date(input.createdFrom)}`);
  }
  if (input.createdTo !== undefined) {
    conditions.push(Prisma.sql`t."createdAt" <= ${new Date(input.createdTo)}`);
  }
  return conditions;
}
