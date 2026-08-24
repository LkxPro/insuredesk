import { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

/** 行为绑定 key 全集：清单内的种类行只启停、不物理删除、key 不可改。 */
export const TICKET_KIND_KEYS = ["complaint", "refund_exception"] as const;
export const ticketKindKeySchema = z.enum(TICKET_KIND_KEYS);
export type TicketKindKey = (typeof TICKET_KIND_KEYS)[number];
export const TicketKindKey = {
  Complaint: "complaint",
  RefundException: "refund_exception",
} as const satisfies Record<string, TicketKindKey>;

export const DEFAULT_TICKET_KINDS: readonly {
  key: TicketKindKey;
  name: string;
  displayOrder: number;
}[] = [
  { key: TicketKindKey.Complaint, name: "投诉", displayOrder: 1 },
  { key: TicketKindKey.RefundException, name: "退费异常", displayOrder: 2 },
];

export const ticketKindCatalogSchemas = createCatalogSchemas("种类");

export const ticketKindCreateInputSchema = ticketKindCatalogSchemas.createInputSchema;
export type TicketKindCreateInput = z.infer<typeof ticketKindCreateInputSchema>;

export const ticketKindUpdateInputSchema = ticketKindCatalogSchemas.updateInputSchema;
export type TicketKindUpdateInput = z.infer<typeof ticketKindUpdateInputSchema>;

export const ticketKindSetActiveInputSchema = ticketKindCatalogSchemas.setActiveInputSchema;
export type TicketKindSetActiveInput = z.infer<typeof ticketKindSetActiveInputSchema>;

export const ticketKindDeleteInputSchema = ticketKindCatalogSchemas.deleteInputSchema;
export type TicketKindDeleteInput = z.infer<typeof ticketKindDeleteInputSchema>;

/** 回调投递状态机：投成才落 delivered；自首试 24h 或 9998 转 dead（告警人工）。 */
export const CALLBACK_DELIVERY_STATUSES = ["pending", "delivered", "dead"] as const;
export type CallbackDeliveryStatus = (typeof CALLBACK_DELIVERY_STATUSES)[number];
