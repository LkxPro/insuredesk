import {
  externalOrgCreateInputSchema,
  externalOrgGetInputSchema,
  externalOrgSetActiveInputSchema,
  externalOrgUpdateInputSchema,
  externalOrgUserCreateInputSchema,
  externalOrgUserListInputSchema,
  externalOrgUserSetActiveInputSchema,
  externalOrgUserUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  createExternalOrg,
  DuplicateOrgNameError,
  getExternalOrg,
  InvalidVisibleFieldError,
  listExternalOrgs,
  OrgNotFoundError,
  setExternalOrgActive,
  updateExternalOrg,
} from "../services/external-org.service";
import {
  createOrgUser,
  DuplicateEmailError,
  DuplicateUsernameError,
  ExternalAccountOnlyError,
  ExternalOrgOptionNotFoundError,
  ExternalRoleNotUniqueError,
  InactiveExternalOrgError,
  listOrgUsers,
  SelfDisableError,
  setOrgUserActive,
  UserNotFoundError,
  updateOrgUser,
} from "../services/user.service";
import { requirePermission, router } from "../trpc";

/**
 * 机构管理 + 机构账号管理, all behind the single external_org.manage point —
 * holding it manages orgs AND their accounts without any user.* point. The
 * account procedures parallel the user.* ones but are fenced to 外部账号 in the
 * service layer.
 */

const deps = { prisma, clock: systemClock };

function toTRPCError(error: unknown): never {
  if (
    error instanceof DuplicateOrgNameError ||
    error instanceof DuplicateUsernameError ||
    error instanceof DuplicateEmailError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (
    error instanceof InvalidVisibleFieldError ||
    error instanceof ExternalOrgOptionNotFoundError ||
    error instanceof InactiveExternalOrgError ||
    error instanceof ExternalAccountOnlyError ||
    error instanceof SelfDisableError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  // 库里外部角色数量不对是部署/种子层面的坏账,不是操作者能改的输入
  if (error instanceof ExternalRoleNotUniqueError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof OrgNotFoundError || error instanceof UserNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

export const externalOrgRouter = router({
  list: requirePermission("external_org.manage").query(() => listExternalOrgs(deps)),

  get: requirePermission("external_org.manage")
    .input(externalOrgGetInputSchema)
    .query(({ input }) => getExternalOrg(deps, input).catch(toTRPCError)),

  create: requirePermission("external_org.manage")
    .input(externalOrgCreateInputSchema)
    .mutation(({ input }) => createExternalOrg(deps, input).catch(toTRPCError)),

  update: requirePermission("external_org.manage")
    .input(externalOrgUpdateInputSchema)
    .mutation(({ input }) => updateExternalOrg(deps, input).catch(toTRPCError)),

  setActive: requirePermission("external_org.manage")
    .input(externalOrgSetActiveInputSchema)
    .mutation(({ input }) => setExternalOrgActive(deps, input).catch(toTRPCError)),

  /** The detail page's account table. */
  listUsers: requirePermission("external_org.manage")
    .input(externalOrgUserListInputSchema)
    .query(({ input }) => listOrgUsers(deps, input).catch(toTRPCError)),

  /** New 机构账号, anchored to the page's org. */
  createUser: requirePermission("external_org.manage")
    .input(externalOrgUserCreateInputSchema)
    .mutation(({ input }) => createOrgUser(deps, input).catch(toTRPCError)),

  /** Edit basic info, optional password reset, org migration. */
  updateUser: requirePermission("external_org.manage")
    .input(externalOrgUserUpdateInputSchema)
    .mutation(({ input }) => updateOrgUser(deps, input).catch(toTRPCError)),

  /** 禁用/启用 — disabling kicks the account's live sessions at once. */
  setUserActive: requirePermission("external_org.manage")
    .input(externalOrgUserSetActiveInputSchema)
    .mutation(({ ctx, input }) => setOrgUserActive(deps, ctx.user, input).catch(toTRPCError)),
});
