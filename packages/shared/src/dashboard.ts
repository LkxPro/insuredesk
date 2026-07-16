/**
 * 数据看板 contract: the 9 metric-card keys and their display labels,
 * single-sourced so the API payload shape, the web card grid, and the
 * integration tests can never disagree on what the 9 cards are.
 *
 * The cards are deliberately NOT a partition (unlike the list's display-status
 * filter): the 4 status cards count the stored status, the 2 time cards are
 * read-time overlays (an overdue assigned ticket counts in both 待处理 and
 * 已超时), and 特急/监管 slice by level/渠道监管标记. Only the 4 status cards
 * sum to 工单总数.
 */

export const DASHBOARD_METRIC_KEYS = [
  "total", // 工单总数
  "unassigned", // 未分配数 (status = unassigned)
  "assigned", // 待处理数 (status = assigned)
  "processing", // 处理中数 (status = processing)
  "completed", // 已完结数 (status = completed)
  "pendingTimeout", // 2小时超时预警数 (dueAt 距今 < 2h 且未完结)
  "overdue", // 已超时数 (dueAt < now 且未完结; 完结即移出, 实时运营视角)
  "urgent", // 特急工单数 (complaintLevel = 特急投诉)
  "regulatory", // 监管单数 (渠道带「计入监管单数」标记)
] as const;
export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[number];

export const DASHBOARD_METRIC_LABELS: Record<DashboardMetricKey, string> = {
  total: "工单总数",
  unassigned: "未分配",
  assigned: "待处理",
  processing: "处理中",
  completed: "已完结",
  pendingTimeout: "2小时超时预警",
  overdue: "已超时",
  urgent: "特急工单",
  regulatory: "监管单",
};

/** 跟进人考核表条目上限. */
export const DASHBOARD_TOP_ASSIGNEE_LIMIT = 10;
