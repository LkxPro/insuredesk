import { z } from "zod";
import { reminderRuleTypeSchema } from "../enums";

/**
 * The rule-engine's canonical SLAPolicy structure (issue #47, ADR 0005). This
 * module is the single owner of the policy shape: the reminder-rule registry
 * lives here as Zod schemas, and every storage/wire boundary normalizes
 * through them, so a JSONB column or an old client can never hand the apps a
 * rule shape the engine doesn't understand — unknown rule types are rejected
 * at parse, never silently skipped.
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
 * The canonical policy value the engine derives, evaluates, and describes
 * from. overdueHours = null means the level has no processing deadline (never
 * due-soon/overdue); the reminder rules alone drive its follow-up cadence.
 */
export interface SlaPolicy {
  firstResponseMinutes: number;
  overdueHours: number | null;
  reminderRules: ReminderRule[];
}

/**
 * Normalize a stored/wire reminder-rule list (e.g. the JSONB column) into the
 * canonical shape. Throws on anything the registry doesn't know — the read
 * boundary must fail loudly rather than misread a newer configuration.
 */
export function normalizeReminderRules(value: unknown): ReminderRule[] {
  return reminderRulesSchema.parse(value);
}
