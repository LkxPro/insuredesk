import { z } from "zod";
import { permissionSchema } from "./permissions";
import { TICKET_CREATE_FIELD_KEYS } from "./ticket-fields";

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

/**
 * 角色建单必填字段集 schema: 每个 key 必须属于建单字段清单，默认空数组 = 全非必填。
 * 三态字段（hasContacted/nuclearBodyStatus）配为必填 = 必须明确选择，不能留默认值。
 */
export const requiredTicketFieldsSchema = z
  .array(z.enum(TICKET_CREATE_FIELD_KEYS))
  .default([])
  .transform((values) => [...new Set(values)]);

/** 角色配置必填集 contract: 管理员不可配（编辑接口拦截），其他角色自由配置。 */
export const roleUpdateRequiredFieldsInputSchema = z.object({
  id: z.string().min(1),
  requiredTicketFields: requiredTicketFieldsSchema,
});
export type RoleUpdateRequiredFieldsInput = z.input<typeof roleUpdateRequiredFieldsInputSchema>;
export type RoleUpdateRequiredFieldsData = z.output<typeof roleUpdateRequiredFieldsInputSchema>;
