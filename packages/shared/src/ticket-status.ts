import { z } from "zod";
import { TICKET_STATUSES, type TicketStatus } from "./enums.ts";

/**
 * Read-time ticket display status. Lives apart from enums.ts on purpose:
 * that file is the single source of *stored* values, while everything here
 * is derived at read time and must never be persisted.
 */

export const COMPUTED_TICKET_STATUSES = ["pending_timeout", "overdue"] as const;
export type ComputedTicketStatus = (typeof COMPUTED_TICKET_STATUSES)[number];
export type TicketDisplayStatus = TicketStatus | ComputedTicketStatus;

export const TICKET_DISPLAY_STATUSES = [
  ...TICKET_STATUSES,
  ...COMPUTED_TICKET_STATUSES,
] as const satisfies readonly TicketDisplayStatus[];
export const ticketDisplayStatusSchema = z.enum(TICKET_DISPLAY_STATUSES);

export const TICKET_STATUS_LABELS: Record<TicketDisplayStatus, string> = {
  unassigned: "未分配",
  assigned: "已分配",
  processing: "处理中",
  completed: "已完结",
  pending_timeout: "待超时",
  overdue: "已超时",
};

export const PENDING_TIMEOUT_WINDOW_MS = 2 * 60 * 60 * 1000;

export function deriveDisplayStatus(
  status: TicketStatus,
  dueAt: Date | null,
  now: Date,
): TicketDisplayStatus {
  if (status === "completed" || dueAt === null) {
    return status;
  }
  if (now.getTime() > dueAt.getTime()) {
    return "overdue";
  }
  if (dueAt.getTime() - now.getTime() < PENDING_TIMEOUT_WINDOW_MS) {
    return "pending_timeout";
  }
  return status;
}
