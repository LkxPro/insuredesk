import { notificationListInputSchema, notificationMarkReadInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notification.service";
import { protectedProcedure, router } from "../trpc";

/**
 * 轨 1 收件箱 routes (issue #25, PRD §3.7): the bell's 30s poll payload and
 * the read-state mutations. Notifications are strictly personal — every query
 * is pinned to the authenticated viewer, so plain protectedProcedure is the
 * whole guard: no permission point, no data-scope variance.
 */

const deps = { prisma, clock: systemClock };

export const notificationRouter = router({
  /** Latest notifications + total unread count, one request per poll. */
  list: protectedProcedure
    .input(notificationListInputSchema.default({}))
    .query(({ ctx, input }) => listNotifications(deps, ctx.user, input)),

  /** Mark one of MY notifications read; others' ids are a silent no-op. */
  markRead: protectedProcedure
    .input(notificationMarkReadInputSchema)
    .mutation(async ({ ctx, input }) => {
      await markNotificationRead(deps, ctx.user, input.id);
      return { ok: true as const };
    }),

  /** 全部已读. */
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllNotificationsRead(deps, ctx.user);
    return { ok: true as const };
  }),
});
