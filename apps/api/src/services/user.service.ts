import type {
  ExternalOrgUserCreateData,
  ExternalOrgUserListInput,
  ExternalOrgUserSetActiveInput,
  ExternalOrgUserUpdateData,
  UserAssignRoleData,
  UserCreateData,
  UserSetActiveInput,
  UserUpdateData,
} from "@insuredesk/shared";
import { isExternalRole } from "@insuredesk/shared";
import { Prisma } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { hashPassword } from "./auth.service";
import { OrgNotFoundError } from "./external-org.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 用户管理 domain logic. Pure service layer — the router maps the domain
 * errors below to transport codes.
 *
 * Accounts are never hard deleted: the `user.delete` point gates
 * 禁用/启用 (the `active` flag), so tickets, process logs, and rosters always
 * keep a live FK target. A disabled account is locked out on BOTH doors:
 * login refuses (PasswordAuthProvider filters on active) and existing
 * sessions die — validateSession re-checks `active` per request, and
 * setUserActive additionally deletes the user's session rows outright.
 */

export class UserNotFoundError extends Error {
  constructor() {
    super("用户不存在");
    this.name = "UserNotFoundError";
  }
}

export class DuplicateUsernameError extends Error {
  constructor() {
    super("用户名已存在");
    this.name = "DuplicateUsernameError";
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("邮箱已被其他用户使用");
    this.name = "DuplicateEmailError";
  }
}

/** The role picker sent an id that no longer exists. */
export class RoleOptionNotFoundError extends Error {
  constructor() {
    super("所选角色不存在");
    this.name = "RoleOptionNotFoundError";
  }
}

/** The 机构 picker on the org detail page sent an id that no longer exists. */
export class ExternalOrgOptionNotFoundError extends Error {
  constructor() {
    super("所选外部机构不存在");
    this.name = "ExternalOrgOptionNotFoundError";
  }
}

/** A 停用 org cannot take on accounts — they could neither submit nor view. */
export class InactiveExternalOrgError extends Error {
  constructor() {
    super("所选外部机构已停用");
    this.name = "InactiveExternalOrgError";
  }
}

/** The target of a 用户管理 operation is an 外部账号 — 机构详情页 owns those. */
export class InternalAccountOnlyError extends Error {
  constructor() {
    super("外部机构账号请在机构详情页管理");
    this.name = "InternalAccountOnlyError";
  }
}

/** 用户管理 only ever hands out 内部角色 — an 外部角色 needs an org to bind to. */
export class InternalRoleOnlyError extends Error {
  constructor() {
    super("只能选择内部角色");
    this.name = "InternalRoleOnlyError";
  }
}

/** Disabling your own account would lock out the operator mid-session. */
export class SelfDisableError extends Error {
  constructor() {
    super("不能禁用自己的账号");
    this.name = "SelfDisableError";
  }
}

/** The mutation would leave zero enabled admin users — the system's one hard invariant. */
export class LastAdminError extends Error {
  constructor() {
    super("系统必须至少保留一名启用的管理员");
    this.name = "LastAdminError";
  }
}

/**
 * Enforce the invariant inside the mutating transaction: count enabled
 * system-role users AFTER the write, throw to roll back when it hit zero.
 * 并发的禁用/改派各写不同的 user 行,行锁互不冲突,READ COMMITTED 下两边的
 * 清点会互相看不见对方未提交的写——先锁系统角色行把清点串行化,后到者
 * 必然看见先到者已提交的结果。
 */
async function assertEnabledAdminRemains(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT id FROM roles WHERE "system" = true FOR UPDATE`;
  const enabledAdmins = await tx.user.count({
    where: { active: true, role: { system: true } },
  });
  if (enabledAdmins === 0) {
    throw new LastAdminError();
  }
}

async function loadRole(prisma: TicketServiceDeps["prisma"], roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, permissions: true, system: true },
  });
  if (!role) {
    throw new RoleOptionNotFoundError();
  }
  return role;
}

/** Resolve the 外部机构 an 外部账号 is being bound to. */
async function resolveExternalOrg(
  prisma: TicketServiceDeps["prisma"],
  externalOrgId: string,
  previousOrgId: string | null = null,
): Promise<string> {
  const org = await prisma.externalOrg.findUnique({
    where: { id: externalOrgId },
    select: { id: true, active: true },
  });
  if (!org) {
    throw new ExternalOrgOptionNotFoundError();
  }
  // A 停用 org takes on no new accounts, but one already bound to it keeps the
  // binding — else every unrelated edit to that account would be blocked until
  // someone re-enables the org.
  if (!org.active && org.id !== previousOrgId) {
    throw new InactiveExternalOrgError();
  }
  return org.id;
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  // Driver adapters carry the violated fields at
  // meta.driverAdapterError.cause.constraint.fields instead of meta.target.
  const cause = (
    error.meta?.driverAdapterError as { cause?: { constraint?: { fields?: unknown } } } | undefined
  )?.cause;
  const fields = cause?.constraint?.fields;
  return Array.isArray(fields) && fields.includes(field);
}

function throwOnDuplicateIdentity(error: unknown): never {
  if (isUniqueViolationOn(error, "username")) {
    throw new DuplicateUsernameError();
  }
  if (isUniqueViolationOn(error, "email")) {
    throw new DuplicateEmailError();
  }
  throw error;
}

/**
 * Every 内部账号, active or not — the 用户管理 table shows disabled users so
 * they can be re-enabled. 外部账号 are out of scope entirely; 机构详情页 is their
 * only management surface. Role name joined live (a rename shows everywhere at
 * once; roles are configuration, not history).
 */
export async function listUsers({ prisma }: TicketServiceDeps) {
  const rows = await prisma.user.findMany({
    where: { externalOrgId: null },
    include: { role: { select: { name: true, system: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    team: row.team,
    active: row.active,
    roleId: row.roleId,
    roleName: row.role.name,
    roleSystem: row.role.system,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Load the role a 用户管理 door is about to hand out, refusing 外部角色: an
 * external account is born on the org detail page and never through here.
 */
async function loadInternalRole(prisma: TicketServiceDeps["prisma"], roleId: string) {
  const role = await loadRole(prisma, roleId);
  if (isExternalRole(role)) {
    throw new InternalRoleOnlyError();
  }
  return role;
}

/**
 * Fence a 用户管理 door to 内部账号. Judged on the org binding rather than the
 * role: the two are equivalent by construction, and the binding is what the
 * list query filters on.
 */
async function assertInternalAccount(prisma: TicketServiceDeps["prisma"], id: string) {
  const target = await prisma.user.findUnique({
    where: { id },
    select: { externalOrgId: true },
  });
  if (!target) {
    throw new UserNotFoundError();
  }
  if (target.externalOrgId !== null) {
    throw new InternalAccountOnlyError();
  }
}

/** New 内部账号, active from the start, password bcrypt-hashed here. */
export async function createUser({ prisma }: TicketServiceDeps, input: UserCreateData) {
  await loadInternalRole(prisma, input.roleId);

  const passwordHash = await hashPassword(input.password);
  try {
    const created = await prisma.user.create({
      data: {
        username: input.username,
        name: input.name,
        email: input.email,
        team: input.team,
        roleId: input.roleId,
        passwordHash,
        active: true,
      },
    });
    return { id: created.id, name: created.name };
  } catch (error) {
    throwOnDuplicateIdentity(error);
  }
}

/**
 * Edit basic info (user.edit), username included — sessions key on userId, so
 * a rename leaves the target's live sessions alone; only the next login needs
 * the new handle. Role changes ride assignUserRole. A non-empty password
 * resets the credential, null leaves it untouched. A reset also deletes the
 * target's sessions in the same transaction — whoever held the old credential
 * must not keep riding a live session past the rotation.
 */
export async function updateUser({ prisma }: TicketServiceDeps, input: UserUpdateData) {
  await assertInternalAccount(prisma, input.id);

  const data: Prisma.UserUncheckedUpdateInput = {
    username: input.username,
    name: input.name,
    email: input.email,
    team: input.team,
  };
  if (input.password !== null) {
    data.passwordHash = await hashPassword(input.password);
  }

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data,
        select: { id: true, name: true },
      });
    } catch (error) {
      // P2025 = no user with that id
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throwOnDuplicateIdentity(error);
    }
    if (input.password !== null) {
      await tx.session.deleteMany({ where: { userId: input.id } });
    }
    return updated;
  });
}

/**
 * 禁用/启用 (the user.delete permission point). Disabling deletes the user's
 * sessions in the same transaction — the "已有会话的下一次请求被拒" guarantee
 * holds even without this (validateSession re-checks `active`), but dead rows
 * shouldn't linger. Self-disable is refused: the operator would saw off the
 * branch they're sitting on. Disabling the last enabled admin is refused —
 * the system's one hard invariant.
 */
export async function setUserActive(
  { prisma }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: UserSetActiveInput,
) {
  if (input.id === actor.id && !input.active) {
    throw new SelfDisableError();
  }
  await assertInternalAccount(prisma, input.id);

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string; active: boolean; role: { system: boolean } };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data: { active: input.active },
        select: { id: true, name: true, active: true, role: { select: { system: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throw error;
    }
    if (!input.active) {
      if (updated.role.system) {
        await assertEnabledAdminRemains(tx);
      }
      await tx.session.deleteMany({ where: { userId: input.id } });
    }
    return { id: updated.id, name: updated.name, active: updated.active };
  });
}

/**
 * 分配角色 (user.assign_role), 内部角色 → 内部角色. Takes effect on the target's
 * very next request: sessions store only the userId — permissions are resolved
 * from the role at validateSession time, never cached. Reassigning the last
 * enabled admin to a non-system role is refused — the system's one hard
 * invariant.
 */
export async function assignUserRole({ prisma }: TicketServiceDeps, input: UserAssignRoleData) {
  const role = await loadInternalRole(prisma, input.roleId);
  await assertInternalAccount(prisma, input.id);

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data: { roleId: input.roleId },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throw error;
    }
    // 派管理员角色只增不减启用管理员数,无须校验
    if (!role.system) {
      await assertEnabledAdminRemains(tx);
    }
    return { ...updated, roleName: role.name };
  });
}

/**
 * Role picker options for the 用户管理 dialogs — 内部角色 only, id + name, with
 * the full permission matrix left behind role.view.
 */
export async function listRoleOptions({ prisma }: TicketServiceDeps) {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, system: true, permissions: true },
    orderBy: [{ system: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return roles
    .filter((role) => !isExternalRole(role))
    .map((role) => ({ id: role.id, name: role.name, system: role.system }));
}

/*
 * 机构账号管理 — the org detail page's account operations, all behind the
 * single external_org.manage point (no user.* required). Every entry below is
 * fenced to 外部账号: without that fence the point would double as a general
 * user-management backdoor onto internal accounts.
 */

/** The target of an org-account operation is not an 外部账号. */
export class ExternalAccountOnlyError extends Error {
  constructor() {
    super("该用户不是外部机构账号");
    this.name = "ExternalAccountOnlyError";
  }
}

/**
 * 建号要挂的唯一外部角色不存在或不唯一。种子提供恰好一个外部角色,数量对不上
 * 说明库被改坏了 — 明确失败,不猜一个顶上：挂错角色等于给外部账号发错权限。
 */
export class ExternalRoleNotUniqueError extends Error {
  constructor(count: number) {
    super(`外部角色应恰好有 1 个，当前 ${count} 个，无法创建机构账号`);
    this.name = "ExternalRoleNotUniqueError";
  }
}

/** Judged on the stored permission array, so 管理员 (system) counts as internal. */
async function loadExternalAccount(prisma: TicketServiceDeps["prisma"], id: string) {
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      externalOrgId: true,
      role: { select: { system: true, permissions: true } },
    },
  });
  if (!target) {
    throw new UserNotFoundError();
  }
  if (!isExternalRole(target.role)) {
    throw new ExternalAccountOnlyError();
  }
  return target;
}

/** The org detail page's account table — no team or role column, accounts have neither. */
export async function listOrgUsers({ prisma }: TicketServiceDeps, input: ExternalOrgUserListInput) {
  const org = await prisma.externalOrg.findUnique({
    where: { id: input.orgId },
    select: { id: true },
  });
  if (!org) {
    throw new OrgNotFoundError();
  }
  const rows = await prisma.user.findMany({
    where: { externalOrgId: input.orgId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * The one 外部角色 every 机构账号 is born holding — 建号不选角色, so the role is
 * looked up here rather than passed in.
 */
async function loadSoleExternalRole(prisma: TicketServiceDeps["prisma"]) {
  const roles = await prisma.role.findMany({
    select: { id: true, system: true, permissions: true },
  });
  const external = roles.filter((role) => isExternalRole(role));
  if (external.length !== 1 || !external[0]) {
    throw new ExternalRoleNotUniqueError(external.length);
  }
  return external[0];
}

/** New 机构账号, anchored to the page's org — a 停用 org takes on no new accounts. */
export async function createOrgUser(
  { prisma }: TicketServiceDeps,
  input: ExternalOrgUserCreateData,
) {
  // 先校机构：机构停用是操作者当场能处理的，外部角色数量不对只有部署侧能修
  const externalOrgId = await resolveExternalOrg(prisma, input.orgId);
  const role = await loadSoleExternalRole(prisma);

  const passwordHash = await hashPassword(input.password);
  try {
    const created = await prisma.user.create({
      data: {
        username: input.username,
        name: input.name,
        email: input.email,
        team: null,
        roleId: role.id,
        externalOrgId,
        passwordHash,
        active: true,
      },
    });
    return { id: created.id, name: created.name };
  } catch (error) {
    throwOnDuplicateIdentity(error);
  }
}

/**
 * Edit a 机构账号: basic info, optional password reset (kills the target's
 * sessions, same as updateUser), and org migration — a 停用 org is refused as
 * a new destination but an existing binding to one survives.
 */
export async function updateOrgUser(
  { prisma }: TicketServiceDeps,
  input: ExternalOrgUserUpdateData,
) {
  const target = await loadExternalAccount(prisma, input.id);
  const externalOrgId = await resolveExternalOrg(prisma, input.externalOrgId, target.externalOrgId);

  const data: Prisma.UserUncheckedUpdateInput = {
    username: input.username,
    name: input.name,
    email: input.email,
    externalOrgId,
  };
  if (input.password !== null) {
    data.passwordHash = await hashPassword(input.password);
  }

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data,
        select: { id: true, name: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throwOnDuplicateIdentity(error);
    }
    if (input.password !== null) {
      await tx.session.deleteMany({ where: { userId: input.id } });
    }
    return updated;
  });
}

/**
 * 禁用/启用 a 机构账号 — same semantics as setUserActive (disable kills live
 * sessions), minus the last-admin check: an 外部账号 is never the system role.
 */
export async function setOrgUserActive(
  { prisma }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: ExternalOrgUserSetActiveInput,
) {
  if (input.id === actor.id && !input.active) {
    throw new SelfDisableError();
  }
  await loadExternalAccount(prisma, input.id);

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string; active: boolean };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data: { active: input.active },
        select: { id: true, name: true, active: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throw error;
    }
    if (!input.active) {
      await tx.session.deleteMany({ where: { userId: input.id } });
    }
    return updated;
  });
}
