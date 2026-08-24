import { z } from "zod";
import { reminderRuleTypeSchema } from "./enums.ts";
import { legacyComplaintLevelInputSchema } from "./ticket.ts";

export const followUpCheckpointRuleSchema = z.object({
  type: z.literal(reminderRuleTypeSchema.enum.follow_up_checkpoint),
  checkpointHours: z.number().int().positive(),
  requiredCount: z.number().int().positive(),
  advanceMinutes: z.number().int().nonnegative(),
});

export const rollingFollowUpRuleSchema = z.object({
  type: z.literal(reminderRuleTypeSchema.enum.rolling_follow_up),
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

export const slaPolicyNameSchema = z
  .string()
  .trim()
  .min(1, "策略名称不能为空")
  .max(100, "策略名称不能超过 100 字");

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

/** description 传 null = 清空。 */
export const slaPolicyUpdateInputSchema = z.object({
  id: z.string().min(1),
  complaintLevel: legacyComplaintLevelInputSchema,
  name: slaPolicyNameSchema.optional(),
  description: z.string().trim().max(500, "策略描述不能超过 500 字").nullable().optional(),
  firstResponseMinutes: z.number().int().positive("首响违约线需为正整数（分钟）").optional(),
  overdueHours: z.number().int().positive("超时时长需为正整数（小时）").nullable().optional(),
  reminderRules: z.array(slaPolicyEditableRuleSchema).optional(),
});
export type SlaPolicyUpdateInput = z.infer<typeof slaPolicyUpdateInputSchema>;

export const slaPolicySortInputSchema = z.object({
  policyIds: z.array(z.string().min(1)).min(1),
});
export type SlaPolicySortInput = z.infer<typeof slaPolicySortInputSchema>;

export const slaPolicySetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type SlaPolicySetActiveInput = z.infer<typeof slaPolicySetActiveInputSchema>;

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

export const DEFAULT_SLA_POLICIES: readonly (SlaPolicyDefaults & { name: string })[] = [
  {
    name: "一般投诉",
    firstResponseMinutes: 120,
    overdueHours: 48,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 1, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 2, advanceMinutes: 180 },
    ],
  },
  {
    name: "高级投诉",
    firstResponseMinutes: 120,
    overdueHours: 48,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 1, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 3, advanceMinutes: 180 },
    ],
  },
  {
    name: "加急投诉",
    firstResponseMinutes: 60,
    overdueHours: 72,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 2, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 4, advanceMinutes: 180 },
      { type: "follow_up_checkpoint", checkpointHours: 72, requiredCount: 6, advanceMinutes: 180 },
    ],
  },
  {
    name: "特急投诉",
    firstResponseMinutes: 30,
    overdueHours: null,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 2, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 4, advanceMinutes: 180 },
      { type: "rolling_follow_up", intervalHours: 12 },
    ],
  },
];

/** 组内默认的选取规则：active 中 sortOrder 最小者。 */
export const DEFAULT_REFUND_SLA_POLICY: SlaPolicyDefaults & { name: string } = {
  name: "退费异常默认策略",
  firstResponseMinutes: 120,
  overdueHours: 48,
  reminderRules: [
    { type: "follow_up_checkpoint", checkpointHours: 36, requiredCount: 1, advanceMinutes: 180 },
  ],
};

export function formatFirstResponseRequirement(firstResponseMinutes: number): string {
  return `${firstResponseMinutes}分钟内完成首次响应`;
}

export function formatFollowUpFrequency(rules: readonly ReminderRule[]): string {
  return rules
    .map((rule) =>
      rule.type === "follow_up_checkpoint"
        ? `${rule.checkpointHours}小时内累计跟进${rule.requiredCount}次`
        : `每${rule.intervalHours}小时至少跟进1次直至完结`,
    )
    .join("；");
}
