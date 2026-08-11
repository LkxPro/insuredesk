import {
  externalAccountCreateInputSchema,
  externalAccountSetActiveInputSchema,
  externalAccountSetExportEnabledInputSchema,
  externalAccountUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db";
import {
  createExternalAccount,
  ExternalAccountOnlyError,
  ExternalRoleNotUniqueError,
  getExternalExportEnabled,
  InvalidVisibleFieldError,
  listExternalAccounts,
  PrefillChannelNotFoundError,
  setExternalAccountActive,
  setExternalExportEnabled,
  updateExternalAccount,
} from "../services/external-account.service";
import {
  DuplicateEmailError,
  DuplicateUsernameError,
  SelfDisableError,
  UserNotFoundError,
} from "../services/user.service";
import { requirePermission, router } from "../trpc";

/**
 * 外部账号管理, all behind the single external_account.manage point — holding
 * it manages external accounts without any user.* point. The procedures
 * parallel the user.* ones but are fenced to 外部账号 in the service layer.
 */

const deps = { prisma };

function toTRPCError(error: unknown): never {
  if (error instanceof DuplicateUsernameError || error instanceof DuplicateEmailError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (
    error instanceof InvalidVisibleFieldError ||
    error instanceof PrefillChannelNotFoundError ||
    error instanceof ExternalAccountOnlyError ||
    error instanceof SelfDisableError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  // 库里外部角色数量不对是部署/种子层面的坏账,不是操作者能改的输入
  if (error instanceof ExternalRoleNotUniqueError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof UserNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

export const externalAccountRouter = router({
  /** The manage page's account table — the edit dialog rides the same row. */
  list: requirePermission("external_account.manage").query(() => listExternalAccounts(deps)),

  /** New 外部账号: basic info + 6 预填 + 白名单; 唯一外部角色服务端挂载。 */
  create: requirePermission("external_account.manage")
    .input(externalAccountCreateInputSchema)
    .mutation(({ input }) => createExternalAccount(deps, input).catch(toTRPCError)),

  /** Edit basic info + 预填/白名单整体替换 + optional password reset. */
  update: requirePermission("external_account.manage")
    .input(externalAccountUpdateInputSchema)
    .mutation(({ input }) => updateExternalAccount(deps, input).catch(toTRPCError)),

  /** 禁用/启用 — disabling kicks the account's live sessions at once. */
  setActive: requirePermission("external_account.manage")
    .input(externalAccountSetActiveInputSchema)
    .mutation(({ ctx, input }) =>
      setExternalAccountActive(deps, ctx.user, input).catch(toTRPCError),
    ),

  /** 外部导出开关现状（唯一外部角色上的权限位）。 */
  exportEnabled: requirePermission("external_account.manage").query(() =>
    getExternalExportEnabled(deps),
  ),

  /** 开/关外部导出 —— 关掉后外部端入口消失、导出接口同步拒绝。 */
  setExportEnabled: requirePermission("external_account.manage")
    .input(externalAccountSetExportEnabledInputSchema)
    .mutation(({ input }) => setExternalExportEnabled(deps, input.enabled).catch(toTRPCError)),
});
