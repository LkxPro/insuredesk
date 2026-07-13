import type { FollowUpCheckpointRule, RollingFollowUpRule } from "./policy";

/**
 * THE canonical SLAPolicy validation (issue #47): field-level and cross-rule
 * checks in one place, consumed by the tRPC input schema (superRefine) and the
 * admin form alike — business rules are edited here, nowhere else. (The
 * engine's Zod schemas in policy.ts still carry structural integer/positive
 * bounds where they guard a parse boundary; they are the same module, not a
 * second implementation to keep in sync.) The checks cover the parent spec's
 * minimum set: positive integers everywhere, checkpoints strictly ascending
 * with non-decreasing cumulative counts, advance strictly inside its own
 * checkpoint window, singleton rule types, and unknown types rejected.
 *
 * Inputs are structural drafts, not parsed policies, so adapters can validate
 * before they have a well-formed value: a form field that failed numeric
 * parsing can be passed as NaN and lands in the same positivity issue.
 */

export interface SlaPolicyValidationIssue {
  /** Where the issue anchors, e.g. ["reminderRules", 2, "advanceMinutes"]. */
  path: (string | number)[];
  message: string;
}

/** A rule as an adapter holds it pre-validation; unknown types are reportable. */
export type SlaReminderRuleDraft = FollowUpCheckpointRule | RollingFollowUpRule | { type: string };

export interface SlaPolicyDraft {
  firstResponseMinutes: number;
  overdueHours: number | null;
  warningAdvanceMinutes?: number | null;
  reminderRules: readonly SlaReminderRuleDraft[];
}

export const SLA_POLICY_VALIDATION_MESSAGES = {
  firstResponseMinutes: "首响违约线需为正整数（分钟）",
  overdueHours: "超时时长需为正整数（小时）",
  warningAdvanceMinutes: "预警提前量需为正整数（分钟）",
  warningWithoutDeadline: "无处理时限时不能配置预警",
  warningExceedsDeadline: "预警提前量必须小于处理时限",
  checkpointHours: "检查点需为正整数（小时）",
  requiredCount: "要求累计跟进需为正整数（次）",
  advanceMinutes: "提前提醒需为正整数（分钟）",
  intervalHours: "跟进间隔需为正整数（小时）",
  advanceBelowCheckpoint: "提前提醒必须小于检查点时长",
  checkpointOrder: "检查点需晚于上一条检查点规则",
  cumulativeCount: "累计跟进次数不能低于上一条检查点规则",
  singletonRolling: "滚动提醒最多配置一条",
  unknownRuleType: "未知的规则类型",
} as const;

function isPositiveInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// Structural narrowing by discriminant only — a draft may still carry NaN or
// missing fields; the field checks below stay defensive on purpose.
function isCheckpointDraft(rule: SlaReminderRuleDraft): rule is FollowUpCheckpointRule {
  return rule.type === "follow_up_checkpoint";
}

function isRollingDraft(rule: SlaReminderRuleDraft): rule is RollingFollowUpRule {
  return rule.type === "rolling_follow_up";
}

/** Every problem in the draft, empty when the policy is publishable. */
export function validateSlaPolicy(draft: SlaPolicyDraft): SlaPolicyValidationIssue[] {
  const issues: SlaPolicyValidationIssue[] = [];
  const messages = SLA_POLICY_VALIDATION_MESSAGES;

  if (!isPositiveInt(draft.firstResponseMinutes)) {
    issues.push({ path: ["firstResponseMinutes"], message: messages.firstResponseMinutes });
  }
  if (draft.overdueHours !== null && !isPositiveInt(draft.overdueHours)) {
    issues.push({ path: ["overdueHours"], message: messages.overdueHours });
  }

  // warningAdvanceMinutes validation (issue #48):
  // Can only be set if there's a deadline, and must be strictly less than it.
  const hasWarning =
    draft.warningAdvanceMinutes !== null && draft.warningAdvanceMinutes !== undefined;
  if (hasWarning) {
    const warningValue = draft.warningAdvanceMinutes!;
    if (draft.overdueHours === null) {
      issues.push({ path: ["warningAdvanceMinutes"], message: messages.warningWithoutDeadline });
    } else if (!isPositiveInt(warningValue)) {
      issues.push({ path: ["warningAdvanceMinutes"], message: messages.warningAdvanceMinutes });
    } else if (isPositiveInt(draft.overdueHours) && warningValue >= draft.overdueHours * 60) {
      issues.push({ path: ["warningAdvanceMinutes"], message: messages.warningExceedsDeadline });
    }
  }

  let previousCheckpoint: FollowUpCheckpointRule | undefined;
  let sawRolling = false;

  draft.reminderRules.forEach((rule, index) => {
    const at = (field: string, message: string) => {
      issues.push({ path: ["reminderRules", index, field], message });
    };

    if (isCheckpointDraft(rule)) {
      if (!isPositiveInt(rule.checkpointHours)) {
        at("checkpointHours", messages.checkpointHours);
      } else if (
        previousCheckpoint !== undefined &&
        rule.checkpointHours <= previousCheckpoint.checkpointHours
      ) {
        // 检查点时间唯一且按时间排序: each checkpoint strictly later than the
        // previous one in list order (equal hours are duplicates, not a sort).
        at("checkpointHours", messages.checkpointOrder);
      }
      if (!isPositiveInt(rule.requiredCount)) {
        at("requiredCount", messages.requiredCount);
      } else if (
        previousCheckpoint !== undefined &&
        rule.requiredCount < previousCheckpoint.requiredCount
      ) {
        // Counts are cumulative from createdAt, so a later checkpoint asking
        // for fewer would retroactively un-require follow-ups (不低于前序).
        at("requiredCount", messages.cumulativeCount);
      }
      // advanceMinutes = 0 is a dead rule (empty alert window) and an advance
      // reaching the checkpoint itself would open the window before the
      // ticket exists — both rejected here, the one editable contract.
      if (!isPositiveInt(rule.advanceMinutes)) {
        at("advanceMinutes", messages.advanceMinutes);
      } else if (
        isPositiveInt(rule.checkpointHours) &&
        rule.advanceMinutes >= rule.checkpointHours * 60
      ) {
        at("advanceMinutes", messages.advanceBelowCheckpoint);
      }
      previousCheckpoint = rule;
      return;
    }

    if (isRollingDraft(rule)) {
      if (sawRolling) {
        // Singleton by meaning: two rolling cadences against the same "last
        // comment" clock contradict each other — only the strictest could
        // ever matter.
        at("intervalHours", messages.singletonRolling);
      }
      sawRolling = true;
      if (!isPositiveInt(rule.intervalHours)) {
        at("intervalHours", messages.intervalHours);
      }
      return;
    }

    at("type", messages.unknownRuleType);
  });

  return issues;
}
