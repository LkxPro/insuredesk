import { z } from "zod";
import { TICKET_STATUS_LABELS } from "./ticket-status.ts";
import { createdRangeFields } from "./time-range.ts";

/**
 * 数据看板 contract: the 8 metric-card keys and their display labels,
 * single-sourced so the API payload shape, the web card grid, and the
 * integration tests can never disagree on what the 8 cards are.
 *
 * The 6 status cards (unassigned/assigned/processing/completed/pendingTimeout/
 * overdue) partition the (non-deleted, non-file_import) ticket set — each
 * ticket matches exactly one at a given instant, and their sum = total.
 * The 特急 card slices by the highest-sortOrder active 时效策略 independently.
 */

export const DASHBOARD_METRIC_KEYS = [
  "total",
  "unassigned",
  "assigned",
  "processing",
  "completed",
  "pendingTimeout",
  "overdue",
  "urgent",
] as const;
export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[number];

export const DASHBOARD_METRIC_LABELS: Record<DashboardMetricKey, string> = {
  total: "工单总数",
  unassigned: TICKET_STATUS_LABELS.unassigned,
  assigned: TICKET_STATUS_LABELS.assigned,
  processing: TICKET_STATUS_LABELS.processing,
  completed: TICKET_STATUS_LABELS.completed,
  pendingTimeout: TICKET_STATUS_LABELS.pending_timeout,
  overdue: TICKET_STATUS_LABELS.overdue,
  urgent: "特急工单",
};

export const DASHBOARD_TOP_ASSIGNEE_LIMIT = 10;

export const dashboardStatsInputSchema = z.object(createdRangeFields);
export type DashboardStatsInput = z.infer<typeof dashboardStatsInputSchema>;
