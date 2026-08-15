import { dashboardStatsInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { getDashboardStats } from "../services/dashboard.service.ts";
import { requirePermission, router } from "../trpc.ts";

/**
 * 数据看板 routes. Thin wrapper: the page permission gates entry; the data
 * permission (dashboard.view_all vs own-only) is applied inside the service
 * via the shared data-scope helper.
 */

const deps = { prisma, clock: systemClock };

export const dashboardRouter = router({
  /** One-shot read powering the whole 数据看板 page. */
  stats: requirePermission("dashboard.view")
    .input(dashboardStatsInputSchema)
    .query(({ ctx, input }) => getDashboardStats(deps, ctx.user, input)),
});
