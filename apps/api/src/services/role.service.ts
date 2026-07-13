import type {
  Permission,
  RoleCreateData,
  RoleDeleteInput,
  RoleRenameInput,
  RoleUpdatePermissionsData,
} from "@insuredesk/shared";
import { Prisma } from "@prisma/client";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 角色管理 domain logic. Pure service layer — the router maps the domain
 * errors below to transport codes.
 *
 * 管理员 is the only system role and the only hard boundary: name, permissions
 * and deletion are all locked. Every other role — factory-seeded or hand-made
 * — is freely renamed, re-permissioned, and deleted; deletion is blocked only
 * while users still hold the role. Permission changes take effect on the next
 * request: sessions resolve permissions from the role at validation time.
 */

export class RoleNotFoundError extends Error {
  constructor() {
    super("角色不存在");
    this.name = "RoleNotFoundError";
  }
}

export class DuplicateRoleNameError extends Error {
  constructor() {
    super("角色名称已存在");
    this.name = "DuplicateRoleNameError";
  }
}

export class SystemRoleProtectedError extends Error {
  constructor() {
    super("管理员是系统角色，不可修改或删除");
    this.name = "SystemRoleProtectedError";
  }
}

/** Deleting a role someone still holds would strand those accounts. */
export class RoleInUseError extends Error {
  constructor(userCount: number) {
    super(`该角色下仍有 ${userCount} 个用户，请先为他们分配其他角色`);
    this.name = "RoleInUseError";
  }
}

function isDuplicateName(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Load a role for mutation, enforcing existence + the system-role lock. */
async function findMutableRole(prisma: TicketServiceDeps["prisma"], id: string) {
  const role = await prisma.role.findUnique({ where: { id }, select: { id: true, system: true } });
  if (!role) {
    throw new RoleNotFoundError();
  }
  if (role.system) {
    throw new SystemRoleProtectedError();
  }
  return role;
}

/**
 * Every role with its full permission set and holder count — the 角色权限
 * page's one read. 管理员 first, then the rest by age.
 */
export async function listRoles({ prisma }: TicketServiceDeps) {
  const rows = await prisma.role.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: [{ system: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    permissions: row.permissions as Permission[],
    system: row.system,
    userCount: row._count.users,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** New role from the 权限点清单 checkboxes; names are unique. */
export async function createRole({ prisma }: TicketServiceDeps, input: RoleCreateData) {
  try {
    const created = await prisma.role.create({
      data: { name: input.name, permissions: input.permissions },
      select: { id: true, name: true },
    });
    return created;
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new DuplicateRoleNameError();
    }
    throw error;
  }
}

/** Rename a role (role.edit); 管理员 refuses. */
export async function renameRole({ prisma }: TicketServiceDeps, input: RoleRenameInput) {
  await findMutableRole(prisma, input.id);
  try {
    return await prisma.role.update({
      where: { id: input.id },
      data: { name: input.name },
      select: { id: true, name: true },
    });
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new DuplicateRoleNameError();
    }
    throw error;
  }
}

/**
 * Replace a role's permission set (role.edit_permission); 管理员 refuses.
 * Every holder is re-judged on their next request — nothing to invalidate.
 */
export async function updateRolePermissions(
  { prisma }: TicketServiceDeps,
  input: RoleUpdatePermissionsData,
) {
  await findMutableRole(prisma, input.id);
  return prisma.role.update({
    where: { id: input.id },
    data: { permissions: input.permissions },
    select: { id: true, name: true, permissions: true },
  });
}

/** Delete a role (role.delete); 管理员 and roles with holders refuse. */
export async function deleteRole({ prisma }: TicketServiceDeps, input: RoleDeleteInput) {
  const role = await prisma.role.findUnique({
    where: { id: input.id },
    select: { id: true, system: true, _count: { select: { users: true } } },
  });
  if (!role) {
    throw new RoleNotFoundError();
  }
  if (role.system) {
    throw new SystemRoleProtectedError();
  }
  if (role._count.users > 0) {
    throw new RoleInUseError(role._count.users);
  }
  await prisma.role.delete({ where: { id: input.id } });
  return { id: input.id };
}
