import {
  COMPLAINT_LEVELS,
  type ComplaintLevel,
  type SlaPolicyUpdateInput,
  reminderRulesSchema,
} from "@insuredesk/shared";
import type { SlaPolicy } from "@prisma/client";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * SLA 策略配置 domain logic (issue #33, PRD §3.8, ADR 0005). Pure service
 * layer per ADR 0006 — the router wraps these with sla.view / sla.edit.
 *
 * There is deliberately no "apply to existing tickets" step: dueAt is stamped
 * once at creation (re-stamped only on a complaintLevel edit, PRD §4.5), and
 * every other consumer — the 我的待办 predicates, the dashboard counters —
 * reads the policy rows at evaluation time. Saving a row IS the rollout
 * (ADR 0005 "只影响之后的读时判定").
 */

function toDto(row: SlaPolicy) {
  return {
    // Truthful cast: list rows are looked up via COMPLAINT_LEVELS and update
    // rows arrive enum-validated, so the column value is always a level.
    complaintLevel: row.complaintLevel as ComplaintLevel,
    firstResponseMinutes: row.firstResponseMinutes,
    overdueHours: row.overdueHours,
    reminderRules: reminderRulesSchema.parse(row.reminderRules),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The four policies in fixed 等级 order — the whole page in one read. */
export async function listSlaPolicies({ prisma }: TicketServiceDeps) {
  const rows = await prisma.slaPolicy.findMany();
  const byLevel = new Map(rows.map((row) => [row.complaintLevel, row]));
  return COMPLAINT_LEVELS.flatMap((level) => {
    const row = byLevel.get(level);
    return row ? [toDto(row)] : [];
  });
}

/**
 * Replace one level's policy (sla.edit). Upsert on the complaintLevel natural
 * key: the level enum is the validated identifier, so a missing row (a
 * never-seeded database) is self-healed rather than erred on.
 */
export async function updateSlaPolicy({ prisma }: TicketServiceDeps, input: SlaPolicyUpdateInput) {
  const data = {
    firstResponseMinutes: input.firstResponseMinutes,
    overdueHours: input.overdueHours,
    reminderRules: input.reminderRules,
  };
  const row = await prisma.slaPolicy.upsert({
    where: { complaintLevel: input.complaintLevel },
    update: data,
    create: { complaintLevel: input.complaintLevel, ...data },
  });
  return toDto(row);
}
