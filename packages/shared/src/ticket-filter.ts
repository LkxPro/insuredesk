/**
 * 工单列表筛选语义单源：status/search/createdFrom/createdTo → 抽象条件。
 * 内部列表翻译成 Prisma where，外部列表翻译成 raw SQL 片段；语义只在这里
 * 定义一次，口径变更只改这里。
 */

export interface TicketListFilterParams<S extends string = string> {
  status?: readonly S[] | undefined;
  search?: string | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}

/**
 * 抽象筛选条件。statuses 保留调用方的状态类型（内部是展示状态、外部是存储
 * 状态），翻译端各自解析；createdAtRange 的 gte/lte 字段名即左闭右闭口径。
 */
export type TicketListFilterCondition<S extends string = string> =
  | { readonly kind: "statusIn"; readonly statuses: readonly S[] }
  | { readonly kind: "search"; readonly term: string }
  | { readonly kind: "createdAtRange"; readonly gte?: Date; readonly lte?: Date };

/**
 * 子串搜索的 LIKE 模式：%直接拼接%、不转义 LIKE 元字符（用户词里的 % 和 _
 * 按通配符生效）。raw SQL 端直接消费它；Prisma `contains` 与此同义，不转义
 * 行为一致，任何一端单独转义都会让搜索支口径分叉。
 */
export function substringSearchPattern(term: string): string {
  return `%${term}%`;
}

export function ticketListFilterConditions<S extends string>(
  input: TicketListFilterParams<S>,
): TicketListFilterCondition<S>[] {
  const conditions: TicketListFilterCondition<S>[] = [];
  if (input.status && input.status.length > 0) {
    conditions.push({ kind: "statusIn", statuses: input.status });
  }
  if (input.search) {
    conditions.push({ kind: "search", term: input.search });
  }
  const gte = input.createdFrom === undefined ? undefined : new Date(input.createdFrom);
  const lte = input.createdTo === undefined ? undefined : new Date(input.createdTo);
  if (gte !== undefined || lte !== undefined) {
    conditions.push({
      kind: "createdAtRange",
      ...(gte !== undefined && { gte }),
      ...(lte !== undefined && { lte }),
    });
  }
  return conditions;
}
