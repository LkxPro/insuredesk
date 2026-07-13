import { z } from "zod";
import { type ComplaintLevel, complaintLevelSchema, reminderRuleTypeSchema } from "./enums";

/**
 * SLAPolicy contracts: one policy row per complaint level, holding the
 * first-response red-line, the overdue duration, and a typed list of
 * reminder rules. The rules are stored as JSONB and validated with these
 * schemas at every read/write boundary, so the database column can never
 * hold a shape the apps don't understand.
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
