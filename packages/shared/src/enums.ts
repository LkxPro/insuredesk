import { z } from "zod";

// 推导状态仅在读取时计算，不存入工单状态。
export const TICKET_STATUSES = ["unassigned", "assigned", "processing", "completed"] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TicketStatus = {
  Unassigned: "unassigned",
  Assigned: "assigned",
  Processing: "processing",
  Completed: "completed",
} as const satisfies Record<string, TicketStatus>;

// 未分配单不可处理，完结单不可再次处理。
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
  "external_note",
] as const;
export const processLogActionSchema = z.enum(PROCESS_LOG_ACTIONS);
export type ProcessLogAction = (typeof PROCESS_LOG_ACTIONS)[number];

export const PROCESS_LOG_ACTION_LABELS: Record<ProcessLogAction, string> = {
  create: "创建工单",
  assign: "分配责任人",
  status_change: "状态变更",
  comment: "跟进记录",
  upload: "上传材料",
  resolve: "确认完结",
  edit: "编辑工单",
  external_note: "外部留言",
};

export const SHIFTS = ["day", "night"] as const;
export const shiftSchema = z.enum(SHIFTS);
export type Shift = (typeof SHIFTS)[number];

export const REMINDER_RULE_TYPES = ["follow_up_checkpoint", "rolling_follow_up"] as const;
export const reminderRuleTypeSchema = z.enum(REMINDER_RULE_TYPES);
export type ReminderRuleType = (typeof REMINDER_RULE_TYPES)[number];

export const TICKET_SOURCES = [
  "feishu_form",
  "manual",
  "community",
  "file_import",
  "external_channel",
  "jb-insurance",
  "huifu",
] as const;
export const ticketSourceSchema = z.enum(TICKET_SOURCES);
export type TicketSource = (typeof TICKET_SOURCES)[number];

// 导入单仅供历史归档，列表和导出默认排除；显式筛选或清空筛选后仍可见。
export const DEFAULT_TICKET_SOURCE_FILTER: readonly TicketSource[] = [
  "feishu_form",
  "manual",
  "community",
  "external_channel",
  "jb-insurance",
  "huifu",
];

// 外部来源以来源标签显示建单人；有 creatorId 的来源使用用户当前姓名。
export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  feishu_form: "飞书",
  manual: "手工录入",
  community: "社区",
  file_import: "文件导入",
  external_channel: "外部渠道",
  "jb-insurance": "骏伯保险平台",
  huifu: "汇付",
};

// 这些来源的建单人显示当前姓名，且无 view_all 权限时仍可通过 creatorId 访问。
export const CREATOR_BACKED_SOURCES: readonly TicketSource[] = [
  "manual",
  "file_import",
  "external_channel",
];
export function isCreatorBackedSource(source: TicketSource): boolean {
  return CREATOR_BACKED_SOURCES.includes(source);
}

// 紧急度不参与 SLA 或 dueAt 计算。
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

export const NUCLEAR_BODY_STATUSES = ["是", "否", "待核实"] as const;
export const nuclearBodyStatusSchema = z.enum(NUCLEAR_BODY_STATUSES);
export type NuclearBodyStatus = (typeof NUCLEAR_BODY_STATUSES)[number];
