import {
  roleCreateInputSchema,
  roleDeleteInputSchema,
  roleRenameInputSchema,
  roleUpdatePermissionsInputSchema,
  roleUpdateRequiredFieldsInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
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
} from "../services/role.service.ts";
import { requirePermission, router } from "../trpc.ts";

const deps = { prisma, clock: systemClock };

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
  list: requirePermission("role.view").query(() => listRoles(deps)),

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

  delete: requirePermission("role.delete")
    .input(roleDeleteInputSchema)
    .mutation(({ input }) => deleteRole(deps, input).catch(toTRPCError)),
});
