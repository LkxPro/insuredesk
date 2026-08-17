import {
  slaPolicyCreateInputSchema,
  slaPolicySetActiveInputSchema,
  slaPolicySortInputSchema,
  slaPolicyUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import {
  createSlaPolicy,
  listSlaPolicies,
  listSlaPolicyOptions,
  SlaPolicyNameConflictError,
  SlaPolicyNotFoundError,
  SlaPolicySortMismatchError,
  setSlaPolicyActive,
  sortSlaPolicies,
  updateSlaPolicy,
} from "../services/sla.service.ts";
import { protectedProcedure, requirePermission, router } from "../trpc.ts";

/**
 * 时效策略 routes: thin wrappers — the shared Zod schemas are the write
 * contract (名称 trim 后非空、正整数、advanceMinutes below its checkpoint),
 * business logic in sla.service. Out of the factory, sla.view / sla.edit
 * are held only by 管理员; sla.options 仅登录（录入下拉源）。
 */

const deps = { prisma, clock: systemClock };

function mapSlaError(error: unknown): never {
  if (error instanceof SlaPolicyNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (error instanceof SlaPolicyNameConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (error instanceof SlaPolicySortMismatchError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

export const slaRouter = router({
  /** The 时效策略管理页's full read: every policy incl. 停用行, 按目录序. */
  list: requirePermission("sla.view").query(() => listSlaPolicies(deps)),

  /** 建单/编辑的时效策略下拉源：仅启用策略（id/name/description，按目录序），仅需登录。 */
  options: protectedProcedure.query(() => listSlaPolicyOptions(deps)),

  /** 新建策略（名称全表唯一，含停用行撞名报错）；sortOrder 追加到末尾。 */
  create: requirePermission("sla.edit")
    .input(slaPolicyCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createSlaPolicy(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),

  /**
   * 按 id 分项更新策略（改名撞含停用行的全表即报错）。保存即时生效 on the
   * next dueAt stamp / 待办 poll。
   */
  update: requirePermission("sla.edit")
    .input(slaPolicyUpdateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateSlaPolicy(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),

  /** 整组排序：清单须恰好覆盖全部策略，顺序即新 sortOrder。 */
  sort: requirePermission("sla.edit")
    .input(slaPolicySortInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await sortSlaPolicies(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),

  /** 停用/复活：停用不拆引用，存量工单照常显示、读时判定降级。 */
  setActive: requirePermission("sla.edit")
    .input(slaPolicySetActiveInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await setSlaPolicyActive(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),
});
