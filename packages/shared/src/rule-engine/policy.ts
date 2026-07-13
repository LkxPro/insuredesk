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
 * Zod schema for the canonical SlaPolicy structure.
 */
export const slaPolicySchema = z.object({
  firstResponseMinutes: z.number().int().positive(),
  overdueHours: z.number().int().positive().nullable(),
  warningAdvanceMinutes: z.number().int().positive().nullable().optional(),
  reminderRules: reminderRulesSchema,
});

/**
 * Zod schema for AppliedSlaPolicy snapshots (issue #48).
 */
export const appliedSlaPolicySchema = z.object({
  schemaVersion: z.literal(1),
  policyRevision: z.number().int().positive(),
  policy: slaPolicySchema,
});

/**
 * The canonical policy value the engine derives, evaluates, and describes
 * from. overdueHours = null means the level has no processing deadline (never
 * due-soon/overdue); the reminder rules alone drive its follow-up cadence.
 * warningAdvanceMinutes = null (or absent) means no early warning for deadlines.
 */
export interface SlaPolicy {
  firstResponseMinutes: number;
  overdueHours: number | null;
  warningAdvanceMinutes?: number | null;
  reminderRules: ReminderRule[];
}

/**
 * The frozen SLA snapshot stored in Ticket.appliedSlaPolicy (issue #48).
 * Includes schema version, policy revision from the ComplaintLevel, and the
 * complete normalized policy. Created once at ticket creation or level change;
 * frozen forever on completion.
 */
export interface AppliedSlaPolicy {
  schemaVersion: number;
  policyRevision: number;
  policy: SlaPolicy;
}

/**
 * Create an AppliedSlaPolicy snapshot from a ComplaintLevel's current policy
 * and revision. The snapshot is immutable once written to a ticket.
 */
export function createAppliedSlaPolicy(
  policyRevision: number,
  policy: SlaPolicy,
): AppliedSlaPolicy {
  return {
    schemaVersion: 1,
    policyRevision,
    policy,
  };
}

/**
 * Normalize a stored/wire reminder-rule list (e.g. the JSONB column) into the
 * canonical shape. Throws on anything the registry doesn't know — the read
 * boundary must fail loudly rather than misread a newer configuration.
 */
export function normalizeReminderRules(value: unknown): ReminderRule[] {
  return reminderRulesSchema.parse(value);
}

/**
 * Normalize a ComplaintLevel.policy JSONB value into a canonical SlaPolicy.
 * Throws if the stored shape doesn't match — policy writes go through the
 * same schema, so a parse failure means data corruption or version skew.
 */
export function normalizeSlaPolicy(value: unknown): SlaPolicy {
  return slaPolicySchema.parse(value);
}

/**
 * Normalize a Ticket.appliedSlaPolicy JSONB value into a canonical
 * AppliedSlaPolicy. Throws if the stored shape is invalid.
 */
export function normalizeAppliedSlaPolicy(value: unknown): AppliedSlaPolicy {
  return appliedSlaPolicySchema.parse(value);
}
