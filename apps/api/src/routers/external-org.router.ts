import {
  externalOrgCreateInputSchema,
  externalOrgSetActiveInputSchema,
  externalOrgUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db";
import {
  createExternalOrg,
  DuplicateOrgNameError,
  InvalidVisibleFieldError,
  listExternalOrgs,
  OrgNotFoundError,
  setExternalOrgActive,
  updateExternalOrg,
} from "../services/external-org.service";
import { requirePermission, router } from "../trpc";

const deps = { prisma };

function toTRPCError(error: unknown): never {
  if (error instanceof DuplicateOrgNameError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (error instanceof InvalidVisibleFieldError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof OrgNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

export const externalOrgRouter = router({
  list: requirePermission("external_org.manage").query(() => listExternalOrgs(deps)),

  create: requirePermission("external_org.manage")
    .input(externalOrgCreateInputSchema)
    .mutation(({ input }) => createExternalOrg(deps, input).catch(toTRPCError)),

  update: requirePermission("external_org.manage")
    .input(externalOrgUpdateInputSchema)
    .mutation(({ input }) => updateExternalOrg(deps, input).catch(toTRPCError)),

  setActive: requirePermission("external_org.manage")
    .input(externalOrgSetActiveInputSchema)
    .mutation(({ input }) => setExternalOrgActive(deps, input).catch(toTRPCError)),
});
