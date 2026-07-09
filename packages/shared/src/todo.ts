import { z } from "zod";

/**
 * 轨 2 我的待办 contracts (issue #30, PRD §3.7/§3.8, ADR 0004): time-derived
 * alerts computed at read time against the viewer's own tickets — never
 * stored, so unlike 轨 1 there is no table shape here, only the alert
 * vocabulary the API emits and the web renders.
 */

export const TODO_ALERT_TYPES = [
  /** 名下 assigned/processing 且尚无第一条 comment — 常驻待办 (PRD §3.8). */
  "awaiting_first_response",
  /** 检查点将至而累计跟进未达标 (SLAPolicy follow_up_checkpoint). */
  "follow_up_checkpoint",
  /** 特急滚动欠跟进: 距上一条 comment 已满 intervalHours (rolling_follow_up). */
  "rolling_follow_up",
  /** 距 dueAt 不足 2 小时 — the list's pending_timeout, worn as an alert. */
  "due_soon",
  /** 已超过 dueAt — the list's overdue, worn as an alert. */
  "overdue",
] as const;
export const todoAlertTypeSchema = z.enum(TODO_ALERT_TYPES);
export type TodoAlertType = (typeof TODO_ALERT_TYPES)[number];

export const TODO_ALERT_LABELS: Record<TodoAlertType, string> = {
  awaiting_first_response: "待首响",
  follow_up_checkpoint: "跟进检查点",
  rolling_follow_up: "滚动跟进",
  due_soon: "即将超时",
  overdue: "已超时",
};

/**
 * Two severities, presentation-only: `warning` renders amber, `critical` red.
 * 待首响 is the one type that moves between them — it enters as warning and
 * turns critical strictly past firstResponseMinutes (黄转红, severity 提升
 * only, never a counting threshold).
 */
export const TODO_SEVERITIES = ["warning", "critical"] as const;
export type TodoSeverity = (typeof TODO_SEVERITIES)[number];
