import { z } from "zod";
import { type ComplaintLevel, complaintLevelSchema } from "./enums";
import { type SlaPolicy, reminderRuleSchema, validateSlaPolicy } from "./rule-engine";

/**
 * SLAPolicy wire contracts (PRD §3.8): one policy row per complaint level.
 * The canonical structure, normalization, and validation live in the
 * rule-engine module; this file keeps only the admin editor's payload schema
 * and the seed defaults. The rules are stored as JSONB and normalized through
 * the engine's schemas at every read/write boundary, so the database column
 * can never hold a shape the apps don't understand (ADR 0005).
 */

/**
 * 管理员编辑器 payload (issue #33), one save per complaint level. The business
 * rules — positive integers, checkpoint ordering and cumulative counts,
 * advance below its checkpoint, singleton rolling, unknown types — come from
 * the engine's validateSlaPolicy, the one canonical implementation (issue
 * #47); the Zod layer contributes the wire shape via the engine's own rule
 * schema.
 */
export const slaPolicyUpdateInputSchema = z
  .object({
    complaintLevel: complaintLevelSchema,
    firstResponseMinutes: z.number(),
    /** null = 不设超时 (never overdue); the editor offers it for any level. */
    overdueHours: z.number().nullable(),
    reminderRules: z.array(reminderRuleSchema),
  })
  .superRefine((input, ctx) => {
    for (const issue of validateSlaPolicy(input)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });
export type SlaPolicyUpdateInput = z.infer<typeof slaPolicyUpdateInputSchema>;

/**
 * Seed defaults per PRD §3.8, in the engine's canonical policy shape. dueAt
 * derives from overdueHours at ticket creation — never hardcoded in ticket
 * logic (PRD §9.2).
 */
export const DEFAULT_SLA_POLICIES: Record<ComplaintLevel, SlaPolicy> = {
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
