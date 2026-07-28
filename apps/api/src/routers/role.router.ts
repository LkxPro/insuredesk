import {
  roleCreateInputSchema,
  roleDeleteInputSchema,
  roleRenameInputSchema,
  roleUpdatePermissionsInputSchema,
  roleUpdateRequiredFieldsInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  createRole,
  DuplicateRoleNameError,
  deleteRole,
  ExternalPermissionForbiddenError,
  ExternalRoleProtectedError,
  listRoles,
  RoleInUseError,
  RoleNotFoundError,
  renameRole,
  SystemRoleProtectedError,
  updateRolePermissions,
  updateRoleRequiredFields,
} from "../services/role.service";
import { requirePermission, router } from "../trpc";

/**
 * 角色管理 routes: thin wrappers — validation via the shared Zod schemas,
 * one permission point per operation (role.view / role.create / role.edit /
 * role.delete / role.edit_permission), business logic in role.service.
 */

const deps = { prisma, clock: systemClock };

/** Domain error → transport code, shared by every mutation below. */
function toTRPCError(error: unknown): never {
  if (error instanceof DuplicateRoleNameError || error instanceof RoleInUseError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (
    error instanceof SystemRoleProtectedError ||
    error instanceof ExternalRoleProtectedError ||
    error instanceof ExternalPermissionForbiddenError
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof RoleNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

export const roleRouter = router({
  /** The 角色权限 page's one read: every role + permissions + holder count. */
  list: requirePermission("role.view").query(() => listRoles(deps)),

  /** New role from the 权限点清单 checkboxes. */
  create: requirePermission("role.create")
    .input(roleCreateInputSchema)
    .mutation(({ input }) => createRole(deps, input).catch(toTRPCError)),

  /** Rename a role — permissions ride updatePermissions. */
  rename: requirePermission("role.edit")
    .input(roleRenameInputSchema)
    .mutation(({ input }) => renameRole(deps, input).catch(toTRPCError)),

  /** Replace a role's permission set — 即时生效 on the next request. */
  updatePermissions: requirePermission("role.edit_permission")
    .input(roleUpdatePermissionsInputSchema)
    .mutation(({ input }) => updateRolePermissions(deps, input).catch(toTRPCError)),

  /** 配置角色建单必填字段集 — 只在手工建单时生效，编辑不受约束。 */
  updateRequiredFields: requirePermission("role.edit_permission")
    .input(roleUpdateRequiredFieldsInputSchema)
    .mutation(({ input }) => updateRoleRequiredFields(deps, input).catch(toTRPCError)),

  /** Delete an unused role; 管理员 and held roles refuse. */
  delete: requirePermission("role.delete")
    .input(roleDeleteInputSchema)
    .mutation(({ input }) => deleteRole(deps, input).catch(toTRPCError)),
});
