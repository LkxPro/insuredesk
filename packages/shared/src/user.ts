import { z } from "zod";

/**
 * 用户管理 contracts, shared by the 用户管理 page and the API — one schema,
 * both ends. Accounts are never hard deleted: `user.delete` maps to 禁用/启用
 * (the `active` flag), so history (tickets, process logs, rosters) always
 * keeps a live FK target.
 *
 * These contracts cover 内部账号 only — 外部账号 live behind the
 * externalOrgUser* set below, so no 所属外部机构 field appears here.
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

/** 自助改密 (profile page) — old credential re-verified server-side. */
export const changeOwnPasswordInputSchema = z.object({
  oldPassword: z.string().min(1, "请输入旧密码"),
  newPassword: passwordSchema,
});
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordInputSchema>;

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
 * Edit basic info (user.edit). Role changes ride user.assignRole (a separate
 * permission point); a non-empty password resets it, empty/null keeps it.
 */
export const userUpdateInputSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  team: optionalTeamSchema,
  password: z
    .union([passwordSchema, z.literal(""), z.null(), z.undefined()])
    .transform((value) => (value ? value : null)),
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

/**
 * 机构详情页的账号管理 (external_org.manage) — a parallel set of contracts
 * rather than the user.* ones: no team field, roles are external-only, and the
 * account's org is anchored to the page's org on create.
 */
export const externalOrgUserListInputSchema = z.object({
  orgId: z.string().min(1),
});
export type ExternalOrgUserListInput = z.infer<typeof externalOrgUserListInputSchema>;

export const externalOrgUserCreateInputSchema = z.object({
  orgId: z.string().min(1),
  username: usernameSchema,
  password: passwordSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  roleId: z.string().min(1, "请选择角色"),
});
export type ExternalOrgUserCreateInput = z.input<typeof externalOrgUserCreateInputSchema>;
export type ExternalOrgUserCreateData = z.output<typeof externalOrgUserCreateInputSchema>;

/**
 * 编辑机构账号: basic info + optional password reset + org migration. The org
 * is required — an external account can move between orgs but never drop one.
 */
export const externalOrgUserUpdateInputSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  password: z
    .union([passwordSchema, z.literal(""), z.null(), z.undefined()])
    .transform((value) => (value ? value : null)),
  externalOrgId: z.string().min(1, "请选择所属外部机构"),
});
export type ExternalOrgUserUpdateInput = z.input<typeof externalOrgUserUpdateInputSchema>;
export type ExternalOrgUserUpdateData = z.output<typeof externalOrgUserUpdateInputSchema>;

export const externalOrgUserSetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type ExternalOrgUserSetActiveInput = z.infer<typeof externalOrgUserSetActiveInputSchema>;

/** 换角色 stays within 外部角色 and never touches the org binding. */
export const externalOrgUserAssignRoleInputSchema = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1, "请选择角色"),
});
export type ExternalOrgUserAssignRoleInput = z.infer<typeof externalOrgUserAssignRoleInputSchema>;
