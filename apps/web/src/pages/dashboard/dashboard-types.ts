import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";

export type DashboardActionStats = inferRouterOutputs<AppRouter>["dashboard"]["actionStats"];
export type DashboardAnalysisStats = inferRouterOutputs<AppRouter>["dashboard"]["analysisStats"];
