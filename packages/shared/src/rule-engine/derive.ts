/**
 * SLA time derivation (issue #47, #48, PRD §9.2). THE dueAt formula: the
 * ticket's original createdAt plus the applied policy's overdueHours — null
 * when the level has no processing deadline. Creation stamps it; a
 * complaintLevel edit re-runs it with the new level's hours against the same
 * unchanging createdAt (ADR 0002: assignment and reassignment never touch the
 * clock).
 */

import { HOUR_MS, MINUTE_MS } from "./time";

export function deriveDueAt(createdAt: Date, overdueHours: number | null): Date | null {
  return overdueHours === null ? null : new Date(createdAt.getTime() + overdueHours * HOUR_MS);
}

/**
 * THE deadlineWarningAt formula (issue #48): dueAt minus the policy's
 * warningAdvanceMinutes. Returns null when there's no deadline, no warning
 * configured, or the warning is disabled. Stamped at creation and recomputed
 * on policy publish alongside dueAt.
 */
export function deriveDeadlineWarningAt(
  dueAt: Date | null,
  warningAdvanceMinutes: number | null | undefined,
): Date | null {
  if (dueAt === null || !warningAdvanceMinutes) {
    return null;
  }
  return new Date(dueAt.getTime() - warningAdvanceMinutes * MINUTE_MS);
}
