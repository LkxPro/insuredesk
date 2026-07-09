import { systemClock } from "../clock";
import { prisma } from "../db";
import { getDashboardStats } from "../services/dashboard.service";
import { requirePermission, router } from "../trpc";

/**
 * 数据看板 routes (issue #29). Thin wrapper per ADR 0006: the page permission
 * gates entry; the data permission (dashboard.view_all vs own-only) is applied
 * inside the service via the shared data-scope helper.
 */

const deps = { prisma, clock: systemClock };

export const dashboardRouter = router({
  /** One-shot read powering the whole 数据看板 page. */
  stats: requirePermission("dashboard.view").query(({ ctx }) => getDashboardStats(deps, ctx.user)),
});
