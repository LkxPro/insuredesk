import { slaPolicyUpdateInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { listSlaPolicies, updateSlaPolicy } from "../services/sla.service";
import { requirePermission, router } from "../trpc";

/**
 * SLA 策略配置 routes (issue #33): thin wrappers per ADR 0006 — the shared Zod
 * schema is the whole write contract (positive numbers, advanceMinutes below
 * its checkpoint), business logic in sla.service. sla.view / sla.edit are held
 * only by the 管理员 preset (PRD §3.8 "管理员可编辑").
 */

const deps = { prisma, clock: systemClock };

export const slaRouter = router({
  /** The SLA 策略 page's one read: all four levels in fixed order. */
  list: requirePermission("sla.view").query(() => listSlaPolicies(deps)),

  /** Replace one level's policy — 即时生效 on the next dueAt stamp / 待办 poll. */
  update: requirePermission("sla.edit")
    .input(slaPolicyUpdateInputSchema)
    .mutation(({ input }) => updateSlaPolicy(deps, input)),
});
