import type { AppRouter } from "@insuredesk/api";
import { TICKET_FIELDS, type TicketFieldOverrides } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";

export type ExternalTicket = inferRouterOutputs<AppRouter>["externalTicket"]["detail"]["ticket"];

export const EXTERNAL_INFO_FIELDS = [
  "policyNumbers",
  "customerName",
  "phone",
  "contactPhone",
] as const;

export type ExternalInfoField = (typeof EXTERNAL_INFO_FIELDS)[number];

export function externalFieldLabel(key: ExternalInfoField): string {
  const descriptor = TICKET_FIELDS[key];
  const overrides: TicketFieldOverrides | undefined =
    "overrides" in descriptor ? descriptor.overrides : undefined;
  return overrides?.detailLabel ?? descriptor.label;
}
