import { type TicketListQuery, ticketListInputSchema } from "@insuredesk/shared";

/** policyId 只读兼容旧下钻链接；与 slaPolicyId 同现时规范名优先。 */
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
    creatorId: multi("creatorId"),
    firstResponse: params.get("firstResponse") ?? undefined,
    policyNumberState: multi("policyNumber"),
    userFeedbackChannelId: multi("userFeedbackChannel"),
    locationCode: params.get("locationCode") ?? undefined,
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
