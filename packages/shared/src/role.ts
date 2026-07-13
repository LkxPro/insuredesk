import { z } from "zod";
import { permissionSchema } from "./permissions";

/**
 * 角色管理 contracts, shared by the 角色权限 page and the API — one schema,
 * both ends. A role is a named set of permission points; 管理员 is the only
 * system role (no rename / permission edit / delete), every other role is
 * freely configured.
 */

export const roleNameSchema = z
  .string()
  .trim()
  .min(1, "请输入角色名称")
  .max(50, "角色名称最长 50 字符");

/**
 * The 权限点清单 checkbox payload: every entry must be a known permission
 * point — unknown strings are rejected, duplicates collapsed.
 */
export const rolePermissionsSchema = z
  .array(permissionSchema)
  .transform((values) => [...new Set(values)]);

export const roleCreateInputSchema = z.object({
  name: roleNameSchema,
  permissions: rolePermissionsSchema,
});
export type RoleCreateInput = z.input<typeof roleCreateInputSchema>;
export type RoleCreateData = z.output<typeof roleCreateInputSchema>;

/** Rename only (role.edit) — permissions ride role.updatePermissions. */
export const roleRenameInputSchema = z.object({
  id: z.string().min(1),
  name: roleNameSchema,
});
export type RoleRenameInput = z.infer<typeof roleRenameInputSchema>;

/** Replace the full permission set (role.edit_permission). */
export const roleUpdatePermissionsInputSchema = z.object({
  id: z.string().min(1),
  permissions: rolePermissionsSchema,
});
export type RoleUpdatePermissionsInput = z.input<typeof roleUpdatePermissionsInputSchema>;
export type RoleUpdatePermissionsData = z.output<typeof roleUpdatePermissionsInputSchema>;

export const roleDeleteInputSchema = z.object({
  id: z.string().min(1),
});
export type RoleDeleteInput = z.infer<typeof roleDeleteInputSchema>;
