import { z } from "zod";
import { createdRangeFields } from "./time-range.ts";

// matrix 未填写列在 cells 里的 key：合法列 key 是目录行 id（cuid），固定哨兵不会撞上。
export const DASHBOARD_MATRIX_UNFILLED_KEY = "unfilled";

export const dashboardAnalysisStatsInputSchema = z.object(createdRangeFields);
export type DashboardAnalysisStatsInput = z.infer<typeof dashboardAnalysisStatsInputSchema>;
