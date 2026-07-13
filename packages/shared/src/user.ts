import { z } from "zod";

/**
 * 用户管理 contracts, shared by the 用户管理 page and the API — one schema,
 * both ends. Accounts are never hard deleted: `user.delete` maps to 禁用/启用
 * (the `active` flag), so history (tickets, process logs, rosters) always
 * keeps a live FK target.
 */

/** Login handle — ASCII word charset so it survives URLs, logs, and seeds. */
export const usernameSchema = z
  .string()
  .trim()
  .min(1, "请输入用户名")
  .max(50, "用户名最长 50 字符")
  .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含字母、数字和 _ . -");

/** bcrypt truncates beyond 72 bytes — cap at the algorithm's limit. */
export const passwordSchema = z.string().min(6, "密码至少 6 位").max(72, "密码最长 72 字符");

const displayNameSchema = z.string().trim().min(1, "请输入姓名").max(50, "姓名最长 50 字符");

/** Optional email: empty input means "none", non-empty must be well-formed. */
const optionalEmailSchema = z
  .union([z.string().trim().email("邮箱格式不正确"), z.literal(""), z.null(), z.undefined()])
  .transform((value) => (value ? value : null));

/** Pure organizational label — drives no permission or filter. */
const optionalTeamSchema = z
  .string()
  .trim()
  .max(50, "团队最长 50 字符")
  .nullish()
  .transform((value) => (value ? value : null));

export const userCreateInputSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  team: optionalTeamSchema,
  roleId: z.string().min(1, "请选择角色"),
});
/** Form-side shape (before transforms). */
export type UserCreateInput = z.input<typeof userCreateInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type UserCreateData = z.output<typeof userCreateInputSchema>;

/**
 * Edit basic info (user.edit). username is immutable — it is the login handle
 * and the seed's natural key. Role changes ride user.assignRole (a separate
 * permission point); a non-empty password resets it, empty/null keeps it.
 */
export const userUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: displayNameSchema,
  email: optionalEmailSchema,
  team: optionalTeamSchema,
  password: z
    .union([passwordSchema, z.literal(""), z.null(), z.undefined()])
    .transform((value) => (value ? value : null)),
});
export type UserUpdateInput = z.input<typeof userUpdateInputSchema>;
export type UserUpdateData = z.output<typeof userUpdateInputSchema>;

/** 禁用/启用 (the PRD's user.delete). Disabling kills the user's sessions. */
export const userSetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type UserSetActiveInput = z.infer<typeof userSetActiveInputSchema>;

export const userAssignRoleInputSchema = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1, "请选择角色"),
});
export type UserAssignRoleInput = z.infer<typeof userAssignRoleInputSchema>;
