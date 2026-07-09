import type {
  UserAssignRoleInput,
  UserCreateData,
  UserSetActiveInput,
  UserUpdateData,
} from "@insuredesk/shared";
import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { hashPassword } from "./auth.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 用户管理 domain logic (issue #32, PRD §2.3/§5.1.3). Pure service layer per
 * ADR 0006 — the router maps the domain errors below to transport codes.
 *
 * Accounts are never hard deleted: the PRD's `user.delete` point gates
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

/** Disabling your own account would lock out the operator mid-session. */
export class SelfDisableError extends Error {
  constructor() {
    super("不能禁用自己的账号");
    this.name = "SelfDisableError";
  }
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target as string[]).includes(field)
  );
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
 * Every account, active or not — the 用户管理 table shows disabled users so
 * they can be re-enabled. Role name joined live (a rename shows everywhere at
 * once; roles are configuration, not history).
 */
export async function listUsers({ prisma }: TicketServiceDeps) {
  const rows = await prisma.user.findMany({
    include: { role: { select: { name: true, preset: true } } },
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
    rolePreset: row.role.preset,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** New account, active from the start, password bcrypt-hashed here. */
export async function createUser({ prisma }: TicketServiceDeps, input: UserCreateData) {
  const role = await prisma.role.findUnique({ where: { id: input.roleId }, select: { id: true } });
  if (!role) {
    throw new RoleOptionNotFoundError();
  }

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
 * Edit basic info (user.edit). username is immutable (login handle + seed
 * natural key); role changes ride assignUserRole. A non-empty password resets
 * the credential, null leaves it untouched.
 */
export async function updateUser({ prisma }: TicketServiceDeps, input: UserUpdateData) {
  const data: Prisma.UserUpdateInput = {
    name: input.name,
    email: input.email,
    team: input.team,
  };
  if (input.password !== null) {
    data.passwordHash = await hashPassword(input.password);
  }

  try {
    const updated = await prisma.user.update({
      where: { id: input.id },
      data,
      select: { id: true, name: true },
    });
    return updated;
  } catch (error) {
    // P2025 = no user with that id
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new UserNotFoundError();
    }
    throwOnDuplicateIdentity(error);
  }
}

/**
 * 禁用/启用 (the PRD's user.delete point). Disabling deletes the user's
 * sessions in the same transaction — the "已有会话的下一次请求被拒" guarantee
 * holds even without this (validateSession re-checks `active`), but dead rows
 * shouldn't linger. Self-disable is refused: the operator would saw off the
 * branch they're sitting on.
 */
export async function setUserActive(
  { prisma }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: UserSetActiveInput,
) {
  if (input.id === actor.id && !input.active) {
    throw new SelfDisableError();
  }

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

/**
 * 分配角色 (user.assign_role). Takes effect on the target's very next request:
 * sessions store only the userId — permissions are resolved from the role at
 * validateSession time, never cached.
 */
export async function assignUserRole({ prisma }: TicketServiceDeps, input: UserAssignRoleInput) {
  const role = await prisma.role.findUnique({
    where: { id: input.roleId },
    select: { id: true, name: true },
  });
  if (!role) {
    throw new RoleOptionNotFoundError();
  }

  try {
    const updated = await prisma.user.update({
      where: { id: input.id },
      data: { roleId: input.roleId },
      select: { id: true, name: true },
    });
    return { ...updated, roleName: role.name };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new UserNotFoundError();
    }
    throw error;
  }
}

/**
 * Role picker options for the 用户管理 dialogs — id + name only, the full
 * permission matrix stays behind role.view.
 */
export async function listRoleOptions({ prisma }: TicketServiceDeps) {
  return prisma.role.findMany({
    select: { id: true, name: true, preset: true },
    orderBy: [{ preset: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}
