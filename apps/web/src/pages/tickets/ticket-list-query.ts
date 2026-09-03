import { type TicketListQuery, ticketListInputSchema } from "@insuredesk/shared";

/**
 * /tickets URL 筛选态编解码（查询串是唯一事实源）。slaPolicyId 的规范参数名
 * 是 slaPolicyId；policyId 是 dashboard 旧下钻链接写过的遗留别名，只读不写，
 * 两者同现时规范名优先。多值维度一律逗号分隔；逐字段 safeParse，非法值静默
 * 丢弃（旧链接/手改 URL 不炸页面）。
 */
export function parseTicketListQuery(params: URLSearchParams): TicketListQuery {
  const multi = (key: string) =>
    params.has(key) ? params.get(key)?.split(",").filter(Boolean) : undefined;
  const candidate = {
    status: multi("status"),
    kindId: multi("kind"),
    channelId: multi("channel"),
    categoryId: multi("category"),
    completionStatusId: multi("completionStatus"),
    slaPolicyId: multi("slaPolicyId") ?? multi("policyId"),
    assigneeId: multi("assigneeId"),
    firstResponse: params.get("firstResponse") ?? undefined,
    policyNumberState: multi("policyNumber"),
    source: multi("source"),
    search: params.get("q") ?? undefined,
    createdFrom: params.get("createdFrom") ?? undefined,
    createdTo: params.get("createdTo") ?? undefined,
    sortBy: params.get("sortBy") ?? undefined,
    sortOrder: params.get("sortOrder") ?? undefined,
    page: params.has("page") ? Number(params.get("page")) : undefined,
  };
  const fields = ticketListInputSchema.shape;
  return ticketListInputSchema.parse(
    Object.fromEntries(
      Object.entries(candidate).map(([key, value]) => [
        key,
        fields[key as keyof typeof fields].safeParse(value).success ? value : undefined,
      ]),
    ),
  );
}

export function serializeSelection(
  values: readonly string[],
  defaultValues: readonly string[],
): string | null {
  if (values.length === 0) {
    return defaultValues.length === 0 ? null : "";
  }
  const sameSet =
    values.length === defaultValues.length && values.every((v) => defaultValues.includes(v));
  return sameSet ? null : values.join(",");
}
