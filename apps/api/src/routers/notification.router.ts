import { notificationListInputSchema, notificationMarkReadInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notification.service.ts";
import { listMyTodos } from "../services/todo.service.ts";
import { protectedProcedure, router } from "../trpc.ts";

/**
 * The 30s poll payload + 轨 1 read-state mutations. One request merges both
 * tracks — `list` carries the 轨 1 inbox slice AND the 轨 2 我的待办 computed
 * at read time. Everything is strictly personal — every query is pinned to
 * the authenticated viewer, so plain protectedProcedure is the whole guard:
 * no permission point, no data-scope variance.
 */

const deps = { prisma, clock: systemClock };

export const notificationRouter = router({
  list: protectedProcedure
    .input(notificationListInputSchema.prefault({}))
    .query(async ({ ctx, input }) => {
      const [inbox, todo] = await Promise.all([
        listNotifications(deps, ctx.user, input),
        listMyTodos(deps, ctx.user),
      ]);
      return { ...inbox, todo };
    }),

  /** Mark one of MY notifications read; others' ids are a silent no-op. */
  markRead: protectedProcedure
    .input(notificationMarkReadInputSchema)
    .mutation(async ({ ctx, input }) => {
      await markNotificationRead(deps, ctx.user, input.id);
      return { ok: true as const };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllNotificationsRead(deps, ctx.user);
    return { ok: true as const };
  }),
});
