import { dashboardAnalysisStatsInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import {
  getDashboardActionStats,
  getDashboardAnalysisStats,
} from "../services/dashboard.service.ts";
import { requirePermission, router } from "../trpc.ts";

const deps = { prisma, clock: systemClock };

export const dashboardRouter = router({
  actionStats: requirePermission("dashboard.view").query(({ ctx }) =>
    getDashboardActionStats(deps, ctx.user),
  ),
  analysisStats: requirePermission("dashboard.view")
    .input(dashboardAnalysisStatsInputSchema)
    .query(({ ctx, input }) => getDashboardAnalysisStats(deps, ctx.user, input)),
});
