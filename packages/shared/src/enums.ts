import { z } from "zod";

/**
 * Domain enum constants, single-sourced here and imported by both apps so the
 * database, API, and UI can never drift apart on the allowed values. Enums the
 * PRD defines with Chinese literals (channel, category, complaint level, …)
 * keep those literals as the canonical stored values — inventing English codes
 * here would be exactly the drift this file exists to prevent.
 */

// Ticket lifecycle — the stored base statuses (computed statuses are derived at
// read time and are not part of this enum). See CONTEXT.md "Status".
export const TICKET_STATUSES = ["unassigned", "assigned", "processing", "completed"] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TicketStatus = {
  Unassigned: "unassigned",
  Assigned: "assigned",
  Processing: "processing",
  Completed: "completed",
} as const satisfies Record<string, TicketStatus>;

// ProcessLog operation types. See CONTEXT.md "ProcessLog".
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

/** Timeline display labels per action (PRD §3.2 操作类型说明). */
export const PROCESS_LOG_ACTION_LABELS: Record<ProcessLogAction, string> = {
  create: "创建工单",
  assign: "分配责任人",
  status_change: "状态变更",
  comment: "跟进记录",
  upload: "上传材料",
  resolve: "确认完结",
  edit: "编辑工单",
};

// Schedule shifts. See CONTEXT.md "Schedule".
export const SHIFTS = ["day", "night"] as const;
export const shiftSchema = z.enum(SHIFTS);
export type Shift = (typeof SHIFTS)[number];

// SLA reminder-rule types used by the "my to-do" read-time predicates.
// See CONTEXT.md "SLAPolicy".
export const REMINDER_RULE_TYPES = ["follow_up_checkpoint", "rolling_follow_up"] as const;
export const reminderRuleTypeSchema = z.enum(REMINDER_RULE_TYPES);
export type ReminderRuleType = (typeof REMINDER_RULE_TYPES)[number];

// Ticket source — how the ticket entered the system; doubles as the "who
// created it" discriminator (PRD §3.1.2 / §3.1.8). Only `manual` is live this
// phase; the external sources ship with the Feishu/community integrations.
export const TICKET_SOURCES = ["feishu_form", "manual", "community"] as const;
export const ticketSourceSchema = z.enum(TICKET_SOURCES);
export type TicketSource = (typeof TICKET_SOURCES)[number];

/**
 * Display labels per source. For external sources this label IS the derived
 * "由谁创建" (PRD §3.1.8); for `manual` the creator's current name wins.
 */
export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  feishu_form: "飞书",
  manual: "手工录入",
  community: "社区",
};

// Feedback channels — the 4 fixed business channels (PRD §3.1.2). Not to be
// confused with source (entry method) or userComplaintChannel (free text).
export const CHANNELS = ["保司", "经纪", "支付", "监管"] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = (typeof CHANNELS)[number];

// Complaint categories — the closed set of 17 (PRD §3.1.5).
export const TICKET_CATEGORIES = [
  "监管投诉-引导性",
  "监管投诉-非引导性",
  "投诉-服务态度",
  "投诉-未履行告知义务",
  "投诉-信息泄露",
  "投诉-保费收取问题",
  "理赔咨询",
  "理赔投诉",
  "退保申请",
  "退保投诉",
  "保单变更",
  "保单查询",
  "续保咨询",
  "核保咨询",
  "产品咨询",
  "回访问题",
  "其他",
] as const;
export const ticketCategorySchema = z.enum(TICKET_CATEGORIES);
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

// Complaint levels — the ONLY SLA driver (PRD §3.1.5, CONTEXT.md). Each level
// has exactly one SLAPolicy row keyed by these literals.
export const COMPLAINT_LEVELS = ["一般投诉", "高级投诉", "加急投诉", "特急投诉"] as const;
export const complaintLevelSchema = z.enum(COMPLAINT_LEVELS);
export type ComplaintLevel = (typeof COMPLAINT_LEVELS)[number];

// Priority — an independent free label (PRD §3.1.5): defaults to empty, set by
// hand, never drives SLA or dueAt.
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

// 保司侧是否核身 (PRD §3.1.4).
export const NUCLEAR_BODY_STATUSES = ["是", "否", "待核实"] as const;
export const nuclearBodyStatusSchema = z.enum(NUCLEAR_BODY_STATUSES);
export type NuclearBodyStatus = (typeof NUCLEAR_BODY_STATUSES)[number];

// Completion statuses — the closed set of 12, no "其他" (PRD §9.1).
export const COMPLETION_STATUSES = [
  "未取得有效联系",
  "已达成一致",
  "诉求过高，无法达成一致",
  "客户自行撤诉",
  "已协商解决",
  "已赔付",
  "已退保",
  "转其他部门处理",
  "无效工单",
  "正常完结",
  "冷处理",
  "联系不上",
] as const;
export const completionStatusSchema = z.enum(COMPLETION_STATUSES);
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];
