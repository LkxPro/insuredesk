import { z } from "zod";

/**
 * 轨 1 收件箱 contracts, shared by the web bell and the API — one schema,
 * both ends.
 *
 * Only user-action-triggered TRUE events live here — this phase solely
 * `assigned` (分配/改派). Time-derived alerts (overdue/due_soon/待首响…) are
 * 轨 2 "我的待办", computed at read time and never stored, so they have no
 * place in this enum.
 */

export const NOTIFICATION_TYPES = ["assigned"] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;

/** Inbox page size — the bell shows the latest slice, not a full archive. */
export const NOTIFICATION_LIST_LIMIT = 20;

export const notificationListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(NOTIFICATION_LIST_LIMIT),
});
export type NotificationListInput = z.input<typeof notificationListInputSchema>;

export const notificationMarkReadInputSchema = z.object({
  id: z.string().min(1),
});
export type NotificationMarkReadInput = z.infer<typeof notificationMarkReadInputSchema>;
