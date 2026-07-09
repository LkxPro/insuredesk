import { z } from "zod";

/**
 * Domain enum constants, single-sourced here and imported by both apps so the
 * database, API, and UI can never drift apart on the allowed values. Only the
 * enums whose codes are already fixed by CONTEXT.md live here; the rest arrive
 * with the tickets that introduce their features.
 */

// Ticket lifecycle — the stored base statuses (computed statuses are derived at
// read time and are not part of this enum). See CONTEXT.md "Status".
export const TICKET_STATUSES = ["unassigned", "assigned", "processing", "completed"] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TicketStatus = {
  Unassigned: "unassigned",
  Assigned: "assigned",
  Processing: "processing",
  Completed: "completed",
} as const satisfies Record<string, TicketStatus>;

// ProcessLog operation types. See CONTEXT.md "ProcessLog".
export const PROCESS_LOG_ACTIONS = [
  "create",
  "assign",
  "status_change",
  "comment",
  "upload",
  "resolve",
  "edit",
] as const;
export const processLogActionSchema = z.enum(PROCESS_LOG_ACTIONS);
export type ProcessLogAction = (typeof PROCESS_LOG_ACTIONS)[number];

// Schedule shifts. See CONTEXT.md "Schedule".
export const SHIFTS = ["day", "night"] as const;
export const shiftSchema = z.enum(SHIFTS);
export type Shift = (typeof SHIFTS)[number];

// SLA reminder-rule types used by the "my to-do" read-time predicates.
// See CONTEXT.md "SLAPolicy".
export const REMINDER_RULE_TYPES = ["follow_up_checkpoint", "rolling_follow_up"] as const;
export const reminderRuleTypeSchema = z.enum(REMINDER_RULE_TYPES);
export type ReminderRuleType = (typeof REMINDER_RULE_TYPES)[number];
