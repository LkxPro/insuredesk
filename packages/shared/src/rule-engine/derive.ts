/**
 * SLA time derivation (issue #47, PRD §9.2). THE dueAt formula: the ticket's
 * original createdAt plus the applied policy's overdueHours — null when the
 * level has no processing deadline. Creation stamps it; a complaintLevel edit
 * re-runs it with the new level's hours against the same unchanging createdAt
 * (ADR 0002: assignment and reassignment never touch the clock).
 */

import { HOUR_MS } from "./time";

export function deriveDueAt(createdAt: Date, overdueHours: number | null): Date | null {
  return overdueHours === null ? null : new Date(createdAt.getTime() + overdueHours * HOUR_MS);
}
