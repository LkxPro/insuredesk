import { slaPolicyUpdateInputSchema } from "@insuredesk/shared";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { listSlaPolicies, updateSlaPolicy } from "../services/sla.service.ts";
import { requirePermission, router } from "../trpc.ts";

/**
 * SLA 策略配置 routes: thin wrappers — the shared Zod schema is the whole
 * write contract (positive numbers, advanceMinutes below its checkpoint),
 * business logic in sla.service. Out of the factory, sla.view / sla.edit
 * are held only by 管理员.
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
