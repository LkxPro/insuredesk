import { z } from "zod";

/**
 * 用户管理 contracts, shared by the 用户管理 page and the API — one schema,
 * both ends. Accounts are never hard deleted: `user.delete` maps to 禁用/启用
 * (the `active` flag), so history (tickets, process logs, rosters) always
 * keeps a live FK target.
 *
 * These contracts cover 内部账号 only — 外部账号 live in external-account.ts,
 * so no prefill/whitelist field appears here.
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

export const changeOwnPasswordInputSchema = z.object({
  oldPassword: z.string().min(1, "请输入旧密码"),
  newPassword: passwordSchema,
});
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordInputSchema>;

export const displayNameSchema = z.string().trim().min(1, "请输入姓名").max(50, "姓名最长 50 字符");

export const optionalEmailSchema = z
  .union([z.string().trim().email("邮箱格式不正确"), z.literal(""), z.null(), z.undefined()])
  .transform((value) => (value ? value : null));

/**
 * Optional password on edit forms: non-empty resets the credential,
 * empty/null keeps it. Reset kills the target's sessions server-side.
 */
export const optionalPasswordResetSchema = z
  .union([passwordSchema, z.literal(""), z.null(), z.undefined()])
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
export type UserCreateInput = z.input<typeof userCreateInputSchema>;
export type UserCreateData = z.output<typeof userCreateInputSchema>;

/**
 * Edit basic info (user.edit). Role changes ride user.assignRole (a separate
 * permission point).
 */
export const userUpdateInputSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  team: optionalTeamSchema,
  password: optionalPasswordResetSchema,
});
export type UserUpdateInput = z.input<typeof userUpdateInputSchema>;
export type UserUpdateData = z.output<typeof userUpdateInputSchema>;

/** 禁用/启用, gated by user.delete. Disabling kills the user's sessions. */
export const userSetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type UserSetActiveInput = z.infer<typeof userSetActiveInputSchema>;

/**
 * 分配角色 — 内部角色之间互换。An account's 内外性质 is fixed at birth: crossing
 * the line means disabling the old account and creating a new one on the other
 * side, so no org rides along here.
 */
export const userAssignRoleInputSchema = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1, "请选择角色"),
});
export type UserAssignRoleInput = z.input<typeof userAssignRoleInputSchema>;
export type UserAssignRoleData = z.output<typeof userAssignRoleInputSchema>;
