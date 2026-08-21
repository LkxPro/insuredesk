import { dashboardStatsInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { getDashboardStats } from "../services/dashboard.service.ts";
import { requirePermission, router } from "../trpc.ts";

const deps = { prisma, clock: systemClock };

export const dashboardRouter = router({
  stats: requirePermission("dashboard.view")
    .input(dashboardStatsInputSchema)
    .query(({ ctx, input }) => getDashboardStats(deps, ctx.user, input)),
});
