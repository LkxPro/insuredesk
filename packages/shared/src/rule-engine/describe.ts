import type { ReminderRule } from "./policy";
import { MINUTE_MS } from "./time";

/**
 * Human-readable SLA copy, generated only here (issue #47): the requirement
 * strings stamped onto tickets, the per-rule lines on the SLA admin page, and
 * the elapsed-duration phrasing inside todo alert messages all come from this
 * module, so no adapter ever re-words a policy.
 */

/** One duration component set, floored to whole minutes: "35 小时 20 分钟". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  if (totalMinutes < 1) {
    return "不足 1 分钟";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return hours > 0 ? `${hours} 小时` : `${minutes} 分钟`;
}

/**
 * Human-readable 首响要求 stamped onto the ticket at creation, derived from the
 * selected level's SLA config (PRD §3.1.5 "由投诉等级的 SLA 配置带出").
 */
export function formatFirstResponseRequirement(firstResponseMinutes: number): string {
  return `${firstResponseMinutes}分钟内完成首次响应`;
}

/**
 * Human-readable 跟进频次要求 stamped onto the ticket at creation, derived from
 * the selected level's reminder rules (PRD §3.1.5).
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

/** One rule as the SLA admin page lists it — full parameters, one line. */
export function describeReminderRule(rule: ReminderRule): string {
  return rule.type === "follow_up_checkpoint"
    ? `${rule.checkpointHours} 小时内累计跟进 ${rule.requiredCount} 次，提前 ${rule.advanceMinutes} 分钟提醒`
    : `距上次跟进每满 ${rule.intervalHours} 小时提醒，直至完结`;
}
