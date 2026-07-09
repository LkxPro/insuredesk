import type { Permission } from "@insuredesk/shared";
import { PRESET_ROLES } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { hashPassword } from "../src/services/auth.service";

/**
 * Single source of truth for the preset roles and demo users. Consumed by both
 * `prisma db seed` (dev database) and the Testcontainers auth tests, so the
 * two can never drift apart (issue #19).
 *
 * Lives in the api package (not @insuredesk/shared) on purpose: the shared
 * package is bundled into the browser and must not depend on @prisma/client
 * or bcryptjs.
 *
 * Upserts keep seeding idempotent: safe to re-run against an existing database.
 */

/** Password shared by every demo account. */
export const DEMO_PASSWORD = "password123";

async function upsertRole(
  prisma: PrismaClient,
  preset: { name: string; permissions: readonly Permission[] },
): Promise<Role> {
  return prisma.role.upsert({
    where: { name: preset.name },
    update: { permissions: [...preset.permissions] },
    create: { name: preset.name, permissions: [...preset.permissions], preset: true },
  });
}

async function upsertUser(
  prisma: PrismaClient,
  data: { username: string; name: string; email: string; roleId: string; passwordHash: string },
): Promise<User> {
  return prisma.user.upsert({
    where: { username: data.username },
    update: {},
    create: { ...data, active: true },
  });
}

/**
 * Create (or refresh) the 4 preset roles and one demo user per role.
 * Returns the created rows so callers can log or assert against them.
 */
export async function seedPresetRolesAndUsers(prisma: PrismaClient): Promise<{
  roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
  users: { admin: User; manager: User; cs1: User; observer: User };
}> {
  const roles = {
    admin: await upsertRole(prisma, PRESET_ROLES.ADMIN),
    csManager: await upsertRole(prisma, PRESET_ROLES.CS_MANAGER),
    frontline: await upsertRole(prisma, PRESET_ROLES.FRONTLINE_CS),
    readOnly: await upsertRole(prisma, PRESET_ROLES.READ_ONLY),
  };

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const users = {
    admin: await upsertUser(prisma, {
      username: "admin",
      name: "系统管理员",
      email: "admin@insuredesk.local",
      roleId: roles.admin.id,
      passwordHash,
    }),
    manager: await upsertUser(prisma, {
      username: "manager",
      name: "李主管",
      email: "manager@insuredesk.local",
      roleId: roles.csManager.id,
      passwordHash,
    }),
    cs1: await upsertUser(prisma, {
      username: "cs1",
      name: "张客服",
      email: "cs1@insuredesk.local",
      roleId: roles.frontline.id,
      passwordHash,
    }),
    observer: await upsertUser(prisma, {
      username: "observer",
      name: "王观察员",
      email: "observer@insuredesk.local",
      roleId: roles.readOnly.id,
      passwordHash,
    }),
  };

  return { roles, users };
}
