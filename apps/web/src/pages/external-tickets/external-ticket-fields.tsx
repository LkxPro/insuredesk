import type { AppRouter } from "@insuredesk/api";
import { TICKET_FIELDS, type TicketFieldOverrides } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * 外部详情信息栏的字段口径：固定 4 个建单字段（保单号/客户姓名/客户电话/
 * 联系人电话），取词与内部详情同一份 descriptor。
 */

export type ExternalTicket = inferRouterOutputs<AppRouter>["externalTicket"]["detail"]["ticket"];

export const EXTERNAL_INFO_FIELDS = [
  "policyNumbers",
  "customerName",
  "phone",
  "contactPhone",
] as const;

export type ExternalInfoField = (typeof EXTERNAL_INFO_FIELDS)[number];

/** 详情卡片标题取词；detailLabel override 优先，缺省用标准名。 */
export function externalFieldLabel(key: ExternalInfoField): string {
  const descriptor = TICKET_FIELDS[key];
  const overrides: TicketFieldOverrides | undefined =
    "overrides" in descriptor ? descriptor.overrides : undefined;
  return overrides?.detailLabel ?? descriptor.label;
}
