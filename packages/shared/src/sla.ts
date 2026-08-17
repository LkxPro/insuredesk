import { z } from "zod";
import { type ComplaintLevel, complaintLevelSchema, reminderRuleTypeSchema } from "./enums.ts";

/**
 * SLAPolicy contracts: the 时效策略 catalog entity holds the first-response
 * red-line, the overdue duration, and a typed list of reminder rules. The
 * rules are stored as JSONB and validated with these schemas at every
 * read/write boundary, so the database column can never hold a shape the
 * apps don't understand.
 */

export const followUpCheckpointRuleSchema = z.object({
  type: z.literal(reminderRuleTypeSchema.enum.follow_up_checkpoint),
  /** Checkpoint measured from ticket createdAt (hours). */
  checkpointHours: z.number().int().positive(),
  /** Cumulative comment count required by the checkpoint (not per-interval). */
  requiredCount: z.number().int().positive(),
  /** How long before the checkpoint the ticket enters "my to-do" (minutes). */
  advanceMinutes: z.number().int().nonnegative(),
});

export const rollingFollowUpRuleSchema = z.object({
  type: z.literal(reminderRuleTypeSchema.enum.rolling_follow_up),
  /** Max gap since the last comment before the ticket enters "my to-do" (hours). */
  intervalHours: z.number().int().positive(),
});

export const reminderRuleSchema = z.discriminatedUnion("type", [
  followUpCheckpointRuleSchema,
  rollingFollowUpRuleSchema,
]);
export const reminderRulesSchema = z.array(reminderRuleSchema);

export type FollowUpCheckpointRule = z.infer<typeof followUpCheckpointRuleSchema>;
export type RollingFollowUpRule = z.infer<typeof rollingFollowUpRuleSchema>;
export type ReminderRule = z.infer<typeof reminderRuleSchema>;

/**
 * 管理员编辑器 payload, one save per complaint level. Stricter than
 * the storage schema on purpose: the read boundary tolerates
 * advanceMinutes = 0, but saving one would create a dead rule (the alert
 * window [checkpoint − advance, checkpoint) is empty), and an advance ≥ the
 * checkpoint itself would open the window before the ticket even exists —
 * both are admin mistakes the form must reject, not shapes to store.
 */
export const slaPolicyEditableRuleSchema = reminderRuleSchema.superRefine((rule, ctx) => {
  if (rule.type !== "follow_up_checkpoint") {
    return;
  }
  if (rule.advanceMinutes < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["advanceMinutes"],
      message: "提前提醒需为正整数（分钟）",
    });
  } else if (rule.advanceMinutes >= rule.checkpointHours * 60) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["advanceMinutes"],
      message: "提前提醒必须小于检查点时长",
    });
  }
});

export const slaPolicyUpdateInputSchema = z.object({
  complaintLevel: complaintLevelSchema,
  firstResponseMinutes: z.number().int().positive("首响违约线需为正整数（分钟）"),
  /** null = 不设超时 (never overdue); the editor offers it for any level. */
  overdueHours: z.number().int().positive("超时时长需为正整数（小时）").nullable(),
  reminderRules: z.array(slaPolicyEditableRuleSchema),
});
export type SlaPolicyUpdateInput = z.infer<typeof slaPolicyUpdateInputSchema>;

// ---------------------------------------------------------------------------
// 时效策略目录契约：实体类型 + CRUD input + sla.options 输出
// ---------------------------------------------------------------------------

/** 策略名：trim 后非空；全表唯一（含停用行）由服务端执法。 */
export const slaPolicyNameSchema = z
  .string()
  .trim()
  .min(1, "策略名称不能为空")
  .max(100, "策略名称不能超过 100 字");

/** 新建时效策略 (sla.create)：sortOrder 服务端追加到末尾，active 恒 true。 */
export const slaPolicyCreateInputSchema = z.object({
  name: slaPolicyNameSchema,
  description: z
    .string()
    .trim()
    .max(500, "策略描述不能超过 500 字")
    .nullish()
    .transform((value) => (value ? value : null)),
  firstResponseMinutes: z.number().int().positive("首响违约线需为正整数（分钟）"),
  /** null = 不设超时 (never overdue). */
  overdueHours: z.number().int().positive("超时时长需为正整数（小时）").nullable(),
  reminderRules: z.array(slaPolicyEditableRuleSchema),
});
export type SlaPolicyCreateInput = z.output<typeof slaPolicyCreateInputSchema>;

/** 按 id 分项更新 (sla.update 新轨)：缺席字段保持原值；description 传 null = 清空。 */
export const slaPolicyEditInputSchema = z.object({
  id: z.string().min(1),
  name: slaPolicyNameSchema.optional(),
  description: z.string().trim().max(500, "策略描述不能超过 500 字").nullable().optional(),
  firstResponseMinutes: z.number().int().positive("首响违约线需为正整数（分钟）").optional(),
  overdueHours: z.number().int().positive("超时时长需为正整数（小时）").nullable().optional(),
  reminderRules: z.array(slaPolicyEditableRuleSchema).optional(),
});
export type SlaPolicyEditInput = z.infer<typeof slaPolicyEditInputSchema>;

/**
 * sla.update 双轨输入：旧轨按 complaintLevel 整体替换（旧前端 SLA 页在用），
 * 新轨按 id 分项更新。两轨字段集互斥，union 按形分派。
 */
export const slaUpdateInputSchema = z.union([slaPolicyUpdateInputSchema, slaPolicyEditInputSchema]);
export type SlaUpdateInput = z.infer<typeof slaUpdateInputSchema>;

/** 整组排序 (sla.sort)：清单须恰好覆盖全部策略（含停用行），顺序即新 sortOrder。 */
export const slaPolicySortInputSchema = z.object({
  policyIds: z.array(z.string().min(1)).min(1),
});
export type SlaPolicySortInput = z.infer<typeof slaPolicySortInputSchema>;

export const slaPolicySetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type SlaPolicySetActiveInput = z.infer<typeof slaPolicySetActiveInputSchema>;

/** 时效策略实体（sla.list 行，含停用行）。 */
export interface SlaPolicyEntity {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  firstResponseMinutes: number;
  overdueHours: number | null;
  reminderRules: ReminderRule[];
  updatedAt: string;
}

/** sla.options 输出项：登录可用的录入下拉源，只含启用策略（按 sortOrder 升序）。 */
export interface SlaPolicyOption {
  id: string;
  name: string;
  description: string | null;
}

export interface SlaPolicyDefaults {
  firstResponseMinutes: number;
  /** null = no overdue deadline (特急: never overdue, driven by rolling follow-up). */
  overdueHours: number | null;
  reminderRules: ReminderRule[];
}

/**
 * Seed defaults (admin-editable). dueAt derives from overdueHours at ticket
 * creation — never hardcoded in ticket logic.
 */
export const DEFAULT_SLA_POLICIES: Record<ComplaintLevel, SlaPolicyDefaults> = {
  一般投诉: {
    firstResponseMinutes: 120,
    overdueHours: 48,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 1, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 2, advanceMinutes: 180 },
    ],
  },
  高级投诉: {
    firstResponseMinutes: 120,
    overdueHours: 48,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 1, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 3, advanceMinutes: 180 },
    ],
  },
  加急投诉: {
    firstResponseMinutes: 60,
    overdueHours: 72,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 2, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 4, advanceMinutes: 180 },
      { type: "follow_up_checkpoint", checkpointHours: 72, requiredCount: 6, advanceMinutes: 180 },
    ],
  },
  特急投诉: {
    firstResponseMinutes: 30,
    overdueHours: null,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 2, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 4, advanceMinutes: 180 },
      { type: "rolling_follow_up", intervalHours: 12 },
    ],
  },
};

/**
 * Human-readable 首响要求 stamped onto the ticket at creation, derived from the
 * selected level's SLA config.
 */
export function formatFirstResponseRequirement(firstResponseMinutes: number): string {
  return `${firstResponseMinutes}分钟内完成首次响应`;
}

/**
 * Human-readable 跟进频次要求 stamped onto the ticket at creation, derived from
 * the selected level's reminder rules.
 */
export function formatFollowUpFrequency(rules: readonly ReminderRule[]): string {
  return rules
    .map((rule) =>
      rule.type === "follow_up_checkpoint"
        ? `${rule.checkpointHours}小时内累计跟进${rule.requiredCount}次`
        : `每${rule.intervalHours}小时至少跟进1次直至完结`,
    )
    .join("；");
}
