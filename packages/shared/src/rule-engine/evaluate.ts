import type { TicketStatus } from "../enums";
import { deriveDisplayStatus } from "../ticket-status";
import type { TodoAlertType, TodoSeverity } from "../todo";
import { formatDuration } from "./describe";
import type { ReminderRule, SlaPolicy } from "./policy";
import { HOUR_MS, MINUTE_MS } from "./time";

/**
 * Read-time SLA alert evaluation (issue #47, ADR 0004/0005): one ticket ×
 * one policy × one explicit instant → the alert list 我的待办 shows. Pure by
 * construction — the caller supplies the clock, the ticket's stored times,
 * and the comment summary; nothing here reads a database or the viewer.
 *
 * Behavior locked by the table-driven tests next to this module:
 * - 待首响 is threshold-free presence (any assigned ticket without a first
 *   comment), and firstResponseMinutes only turns it critical strictly past
 *   the red line — a color change, never a counting gate (PRD §3.8).
 * - A checkpoint alerts inside [checkpoint − advance, checkpoint) — start
 *   inclusive, checkpoint exclusive — while the cumulative comment count is
 *   short; a window already passed simply never matches again (无补发特判).
 * - Rolling follow-up starts from the LAST comment; with no comment yet there
 *   is nothing to roll from — the constant 待首响 already covers the ticket.
 *   满 intervalHours is inclusive (>=).
 * - due_soon / overdue restate nothing: they wear deriveDisplayStatus, the
 *   same single-truth predicate the list and dashboard use (ADR 0001).
 * - A missing policy degrades, never breaks: 待首响 stays warning (no red
 *   line), rule alerts vanish, while due_soon/overdue keep working off the
 *   stored dueAt. 未定级 tickets take this same path by construction.
 * - completed stops everything: no alert type survives the terminal state.
 */

export interface SlaAlert {
  type: TodoAlertType;
  severity: TodoSeverity;
  message: string;
}

/** The observable ticket facts the engine judges — no entity, just the clockwork. */
export interface TicketSlaFacts {
  status: TicketStatus;
  createdAt: Date;
  /** The stored deadline stamp — NOT re-derived here; today only a complaintLevel edit re-stamps it (PRD §4.5). */
  dueAt: Date | null;
  /** Cumulative comment count since createdAt, across assignees. */
  commentCount: number;
  /** Instant of the latest comment; null when none exists yet. */
  lastCommentAt: Date | null;
}

export function evaluateTicketSla(
  policy: Pick<SlaPolicy, "firstResponseMinutes" | "reminderRules"> | null,
  ticket: TicketSlaFacts,
  now: Date,
): SlaAlert[] {
  if (ticket.status === "completed") {
    return [];
  }

  const alerts: SlaAlert[] = [];

  if (ticket.commentCount === 0) {
    const redLineMs =
      policy === null ? null : ticket.createdAt.getTime() + policy.firstResponseMinutes * MINUTE_MS;
    alerts.push({
      type: "awaiting_first_response",
      severity: redLineMs !== null && now.getTime() > redLineMs ? "critical" : "warning",
      message: `尚未首次跟进，已等待 ${formatDuration(now.getTime() - ticket.createdAt.getTime())}`,
    });
  }

  for (const rule of policy?.reminderRules ?? []) {
    alerts.push(...evaluateRule(rule, ticket, now));
  }

  const displayStatus = deriveDisplayStatus(ticket.status, ticket.dueAt, now);
  if (displayStatus === "pending_timeout") {
    alerts.push({
      type: "due_soon",
      severity: "warning",
      message: "距处理时限不足 2 小时",
    });
  } else if (displayStatus === "overdue" && ticket.dueAt !== null) {
    alerts.push({
      type: "overdue",
      severity: "critical",
      message: `已超过处理时限 ${formatDuration(now.getTime() - ticket.dueAt.getTime())}`,
    });
  }

  return alerts;
}

/** One reminder rule against one ticket at one instant — a pure predicate. */
function evaluateRule(rule: ReminderRule, ticket: TicketSlaFacts, now: Date): SlaAlert[] {
  if (rule.type === "follow_up_checkpoint") {
    const checkpointMs = ticket.createdAt.getTime() + rule.checkpointHours * HOUR_MS;
    const windowStartMs = checkpointMs - rule.advanceMinutes * MINUTE_MS;
    if (
      now.getTime() >= windowStartMs &&
      now.getTime() < checkpointMs &&
      ticket.commentCount < rule.requiredCount
    ) {
      return [
        {
          type: "follow_up_checkpoint",
          severity: "warning",
          message: `${rule.checkpointHours} 小时检查点将至：已跟进 ${ticket.commentCount}/${rule.requiredCount} 次`,
        },
      ];
    }
    return [];
  }

  if (
    ticket.lastCommentAt !== null &&
    now.getTime() - ticket.lastCommentAt.getTime() >= rule.intervalHours * HOUR_MS
  ) {
    return [
      {
        type: "rolling_follow_up",
        severity: "critical",
        message: `距上次跟进已 ${formatDuration(now.getTime() - ticket.lastCommentAt.getTime())}，要求每 ${rule.intervalHours} 小时跟进`,
      },
    ];
  }
  return [];
}
