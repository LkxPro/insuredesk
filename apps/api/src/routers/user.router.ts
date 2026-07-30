import {
  userAssignRoleInputSchema,
  userCreateInputSchema,
  userSetActiveInputSchema,
  userUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  assignUserRole,
  createUser,
  DuplicateEmailError,
  DuplicateUsernameError,
  InternalAccountOnlyError,
  InternalRoleOnlyError,
  LastAdminError,
  listRoleOptions,
  listUsers,
  RoleOptionNotFoundError,
  SelfDisableError,
  setUserActive,
  UserNotFoundError,
  updateUser,
} from "../services/user.service";
import { requireAnyPermission, requirePermission, router } from "../trpc";

/**
 * 用户管理 routes: thin wrappers — validation via the shared Zod schemas,
 * one permission point per operation (user.view / user.create / user.edit /
 * user.delete / user.assign_role), business logic in user.service.
 *
 * Scope is 内部账号 only: 外部账号 answer to external_account.manage on the
 * 外部账号管理 page, and every door below refuses them as targets.
 */

const deps = { prisma, clock: systemClock };

/** Domain error → transport code, shared by every mutation below. */
function toTRPCError(error: unknown): never {
  if (error instanceof DuplicateUsernameError || error instanceof DuplicateEmailError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (
    error instanceof RoleOptionNotFoundError ||
    error instanceof SelfDisableError ||
    error instanceof InternalAccountOnlyError ||
    error instanceof InternalRoleOnlyError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof LastAdminError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof UserNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

export const userRouter = router({
  /** The 用户管理 table — every 内部账号 with its role, disabled ones included. */
  list: requirePermission("user.view").query(() => listUsers(deps)),

  /** New account with an initial password and a role. */
  create: requirePermission("user.create")
    .input(userCreateInputSchema)
    .mutation(({ input }) => createUser(deps, input).catch(toTRPCError)),

  /** Edit basic info; optional password reset. Role changes ride assignRole. */
  update: requirePermission("user.edit")
    .input(userUpdateInputSchema)
    .mutation(({ input }) => updateUser(deps, input).catch(toTRPCError)),

  /** 禁用/启用 rides the user.delete permission point; disabling kills live sessions. */
  setActive: requirePermission("user.delete")
    .input(userSetActiveInputSchema)
    .mutation(({ ctx, input }) => setUserActive(deps, ctx.user, input).catch(toTRPCError)),

  /** 分配角色 — effective on the target's next request. */
  assignRole: requirePermission("user.assign_role")
    .input(userAssignRoleInputSchema)
    .mutation(({ input }) => assignUserRole(deps, input).catch(toTRPCError)),

  /**
   * Role picker for the create/assign dialogs — 内部角色 names only, re-guarded
   * for user managers who hold no role.view (same pattern as dutyUserOptions).
   */
  roleOptions: requireAnyPermission(["user.create", "user.assign_role"]).query(() =>
    listRoleOptions(deps),
  ),
});
