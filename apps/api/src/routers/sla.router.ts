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
  list: requirePermission("sla.view").query(() => listSlaPolicies(deps)),

  options: protectedProcedure.query(() => listSlaPolicyOptions(deps)),

  create: requirePermission("sla.edit")
    .input(slaPolicyCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createSlaPolicy(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),

  update: requirePermission("sla.edit")
    .input(slaPolicyUpdateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateSlaPolicy(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),

  sort: requirePermission("sla.edit")
    .input(slaPolicySortInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await sortSlaPolicies(deps, input);
      } catch (error) {
        mapSlaError(error);
      }
    }),

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
