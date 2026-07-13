import {
  COMPLAINT_LEVELS,
  type ComplaintLevel,
  type SlaPolicyUpdateInput,
  normalizeReminderRules,
} from "@insuredesk/shared";
import type { SlaPolicy as SlaPolicyRow } from "@prisma/client";
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

function toDto(row: SlaPolicyRow) {
  return {
    // Truthful cast: list rows are looked up via COMPLAINT_LEVELS and update
    // rows arrive enum-validated, so the column value is always a level.
    complaintLevel: row.complaintLevel as ComplaintLevel,
    firstResponseMinutes: row.firstResponseMinutes,
    overdueHours: row.overdueHours,
    reminderRules: normalizeReminderRules(row.reminderRules),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The four policies in fixed 等级 order — the whole page in one read.
 * Now reads from ComplaintLevel directory (issue #48 migration).
 */
export async function listSlaPolicies({ prisma }: TicketServiceDeps) {
  const rows = await prisma.complaintLevel.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return rows
    .filter((row) => COMPLAINT_LEVELS.indexOf(row.name as ComplaintLevel) >= 0)
    .map((row) => {
      const policy = row.policy as Record<string, unknown>;
      return {
        complaintLevel: row.name as ComplaintLevel,
        firstResponseMinutes: policy.firstResponseMinutes as number,
        overdueHours: policy.overdueHours as number | null,
        reminderRules: normalizeReminderRules(policy.reminderRules),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
}

/**
 * Replace one level's policy (sla.edit). Upsert on the complaintLevel natural
 * key: the level enum is the validated identifier, so a missing row (a
 * never-seeded database) is self-healed rather than erred on.
 *
 * TEMPORARY (issue #48 migration): also updates the ComplaintLevel policy so
 * new tickets use the updated policy. This dual-write keeps existing tests
 * passing during the transition.
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

  // TEMPORARY dual-write: also update ComplaintLevel so new tickets get the
  // updated policy. This preserves existing test behavior during migration.
  await prisma.complaintLevel.updateMany({
    where: { name: input.complaintLevel },
    data: {
      policy: {
        ...data,
        warningAdvanceMinutes: null,
      },
      policyRevision: { increment: 1 },
    },
  });

  return toDto(row);
}
