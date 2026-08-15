import type {
  RoleCreateData,
  RoleDeleteInput,
  RoleRenameInput,
  RoleUpdatePermissionsData,
  RoleUpdateRequiredFieldsData,
} from "@insuredesk/shared";
import { EXTERNAL_ROLE_PERMISSIONS, isExternalRole } from "@insuredesk/shared";
import { Prisma } from "../generated/prisma/client.ts";
import { effectivePermissions } from "./auth.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";

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

export class ExternalRoleProtectedError extends Error {
  constructor() {
    super("外部角色不可通过管理界面修改或删除");
    this.name = "ExternalRoleProtectedError";
  }
}

export class ExternalPermissionForbiddenError extends Error {
  constructor() {
    super("不可通过管理界面配置外部权限点");
    this.name = "ExternalPermissionForbiddenError";
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

async function findMutableRole(prisma: TicketServiceDeps["prisma"], id: string) {
  const role = await prisma.role.findUnique({
    where: { id },
    select: { id: true, system: true, permissions: true },
  });
  if (!role) {
    throw new RoleNotFoundError();
  }
  if (role.system) {
    throw new SystemRoleProtectedError();
  }
  if (isExternalRole(role)) {
    throw new ExternalRoleProtectedError();
  }
  return role;
}

export async function listRoles({ prisma }: TicketServiceDeps) {
  const rows = await prisma.role.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: [{ system: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows
    .filter((row) => !isExternalRole(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      permissions: effectivePermissions(row),
      system: row.system,
      userCount: row._count.users,
      requiredTicketFields: row.requiredTicketFields,
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

export async function updateRolePermissions(
  { prisma }: TicketServiceDeps,
  input: RoleUpdatePermissionsData,
) {
  await findMutableRole(prisma, input.id);
  const hasExternalPermission = input.permissions.some((p) =>
    EXTERNAL_ROLE_PERMISSIONS.includes(p as (typeof EXTERNAL_ROLE_PERMISSIONS)[number]),
  );
  if (hasExternalPermission) {
    throw new ExternalPermissionForbiddenError();
  }
  return prisma.role.update({
    where: { id: input.id },
    data: { permissions: input.permissions },
    select: { id: true, name: true, permissions: true },
  });
}

/**
 * 配置角色建单必填字段集 (role.edit_permission)；管理员拒绝。
 * 必填约束只在建单时生效，编辑不受影响；字段清单外的 key 被 Zod 提前拦截。
 */
export async function updateRoleRequiredFields(
  { prisma }: TicketServiceDeps,
  input: RoleUpdateRequiredFieldsData,
) {
  await findMutableRole(prisma, input.id);
  return prisma.role.update({
    where: { id: input.id },
    data: { requiredTicketFields: input.requiredTicketFields },
    select: { id: true, name: true, requiredTicketFields: true },
  });
}

export async function deleteRole({ prisma }: TicketServiceDeps, input: RoleDeleteInput) {
  await findMutableRole(prisma, input.id);
  const userCount = await prisma.user.count({ where: { roleId: input.id } });
  if (userCount > 0) {
    throw new RoleInUseError(userCount);
  }
  await prisma.role.delete({ where: { id: input.id } });
  return { id: input.id };
}
