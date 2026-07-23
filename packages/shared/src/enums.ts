import { z } from "zod";

/**
 * Domain enum constants, single-sourced here and imported by both apps so the
 * database, API, and UI can never drift apart on the allowed values. Enums the
 * PRD defines with Chinese literals (complaint level, 核身 status, …) keep
 * those literals as the canonical stored values — inventing English codes
 * here would be exactly the drift this file exists to prevent.
 */

// Ticket lifecycle — the stored base statuses (computed statuses are derived at
// read time and are not part of this enum).
export const TICKET_STATUSES = ["unassigned", "assigned", "processing", "completed"] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TicketStatus = {
  Unassigned: "unassigned",
  Assigned: "assigned",
  Processing: "processing",
  Completed: "completed",
} as const satisfies Record<string, TicketStatus>;

/**
 * 已分配未完结 (assigned/processing) — the only states the 处理工单 actions
 * (添加跟进 / 完结) may act on: unassigned has nobody to act on it, completed
 * is a 终态.
 */
export function isTicketInFlight(status: TicketStatus): boolean {
  return status === "assigned" || status === "processing";
}

export const PROCESS_LOG_ACTIONS = [
  "create",
  "assign",
  "status_change",
  "comment",
  "upload",
  "resolve",
  "edit",
] as const;
export const processLogActionSchema = z.enum(PROCESS_LOG_ACTIONS);
export type ProcessLogAction = (typeof PROCESS_LOG_ACTIONS)[number];

/** Timeline display labels per action. */
export const PROCESS_LOG_ACTION_LABELS: Record<ProcessLogAction, string> = {
  create: "创建工单",
  assign: "分配责任人",
  status_change: "状态变更",
  comment: "跟进记录",
  upload: "上传材料",
  resolve: "确认完结",
  edit: "编辑工单",
};

export const SHIFTS = ["day", "night"] as const;
export const shiftSchema = z.enum(SHIFTS);
export type Shift = (typeof SHIFTS)[number];

// SLA reminder-rule types used by the "my to-do" read-time predicates.
export const REMINDER_RULE_TYPES = ["follow_up_checkpoint", "rolling_follow_up"] as const;
export const reminderRuleTypeSchema = z.enum(REMINDER_RULE_TYPES);
export type ReminderRuleType = (typeof REMINDER_RULE_TYPES)[number];

// Ticket source — how the ticket entered the system; doubles as the "who
// created it" discriminator. `manual` and `file_import` are live; the external
// sources ship with the Feishu/community integrations.
export const TICKET_SOURCES = ["feishu_form", "manual", "community", "file_import"] as const;
export const ticketSourceSchema = z.enum(TICKET_SOURCES);
export type TicketSource = (typeof TICKET_SOURCES)[number];

/**
 * Display labels per source. For external sources this label IS the derived
 * "由谁创建"; for creator-backed sources the creator's current name wins.
 */
export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  feishu_form: "飞书",
  manual: "手工录入",
  community: "社区",
  file_import: "文件导入",
};

/**
 * Sources whose tickets carry a creatorId (手工录入的建单人 / 文件导入的导入者).
 * Their "由谁创建" derives from the creator's current name, and the
 * non-view_all data scope reaches them through creatorId.
 */
export const CREATOR_BACKED_SOURCES: readonly TicketSource[] = ["manual", "file_import"];
export function isCreatorBackedSource(source: TicketSource): boolean {
  return CREATOR_BACKED_SOURCES.includes(source);
}

// Complaint levels — the ONLY SLA driver. Each level has exactly one
// SLAPolicy row keyed by these literals.
export const COMPLAINT_LEVELS = ["一般投诉", "高级投诉", "加急投诉", "特急投诉"] as const;
export const complaintLevelSchema = z.enum(COMPLAINT_LEVELS);
export type ComplaintLevel = (typeof COMPLAINT_LEVELS)[number];

// Priority — an independent free label: defaults to empty, set by hand, never
// drives SLA or dueAt.
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

// 保司侧是否核身.
export const NUCLEAR_BODY_STATUSES = ["是", "否", "待核实"] as const;
export const nuclearBodyStatusSchema = z.enum(NUCLEAR_BODY_STATUSES);
export type NuclearBodyStatus = (typeof NUCLEAR_BODY_STATUSES)[number];
