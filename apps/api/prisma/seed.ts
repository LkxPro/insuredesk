import { PrismaClient } from "@prisma/client";
import { PRESET_ROLES } from "@insuredesk/shared";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed script for development and testing.
 * Creates the 4 preset roles and sample users for each role.
 *
 * Run with: pnpm prisma db seed
 */

async function main() {
  console.log("🌱 Seeding database...");

  // Create preset roles
  console.log("\n📋 Creating preset roles...");

  const adminRole = await prisma.role.upsert({
    where: { name: PRESET_ROLES.ADMIN.name },
    update: { permissions: PRESET_ROLES.ADMIN.permissions },
    create: {
      name: PRESET_ROLES.ADMIN.name,
      permissions: PRESET_ROLES.ADMIN.permissions,
      preset: true,
    },
  });
  console.log(`✓ Created role: ${adminRole.name}`);

  const csManagerRole = await prisma.role.upsert({
    where: { name: PRESET_ROLES.CS_MANAGER.name },
    update: { permissions: PRESET_ROLES.CS_MANAGER.permissions },
    create: {
      name: PRESET_ROLES.CS_MANAGER.name,
      permissions: PRESET_ROLES.CS_MANAGER.permissions,
      preset: true,
    },
  });
  console.log(`✓ Created role: ${csManagerRole.name}`);

  const frontlineRole = await prisma.role.upsert({
    where: { name: PRESET_ROLES.FRONTLINE_CS.name },
    update: { permissions: PRESET_ROLES.FRONTLINE_CS.permissions },
    create: {
      name: PRESET_ROLES.FRONTLINE_CS.name,
      permissions: PRESET_ROLES.FRONTLINE_CS.permissions,
      preset: true,
    },
  });
  console.log(`✓ Created role: ${frontlineRole.name}`);

  const readOnlyRole = await prisma.role.upsert({
    where: { name: PRESET_ROLES.READ_ONLY.name },
    update: { permissions: PRESET_ROLES.READ_ONLY.permissions },
    create: {
      name: PRESET_ROLES.READ_ONLY.name,
      permissions: PRESET_ROLES.READ_ONLY.permissions,
      preset: true,
    },
  });
  console.log(`✓ Created role: ${readOnlyRole.name}`);

  // Create sample users (one for each role)
  console.log("\n👥 Creating sample users...");

  // Password for all demo users: "password123"
  const demoPassword = "password123";
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      name: "系统管理员",
      email: "admin@insuredesk.local",
      roleId: adminRole.id,
      active: true,
    },
  });
  console.log(`✓ Created user: ${admin.username} (${admin.name}) - Role: ${adminRole.name}`);

  const manager = await prisma.user.upsert({
    where: { username: "manager" },
    update: {},
    create: {
      username: "manager",
      passwordHash,
      name: "李主管",
      email: "manager@insuredesk.local",
      roleId: csManagerRole.id,
      active: true,
    },
  });
  console.log(`✓ Created user: ${manager.username} (${manager.name}) - Role: ${csManagerRole.name}`);

  const frontline = await prisma.user.upsert({
    where: { username: "cs1" },
    update: {},
    create: {
      username: "cs1",
      passwordHash,
      name: "张客服",
      email: "cs1@insuredesk.local",
      roleId: frontlineRole.id,
      active: true,
    },
  });
  console.log(`✓ Created user: ${frontline.username} (${frontline.name}) - Role: ${frontlineRole.name}`);

  const observer = await prisma.user.upsert({
    where: { username: "observer" },
    update: {},
    create: {
      username: "observer",
      passwordHash,
      name: "王观察员",
      email: "observer@insuredesk.local",
      roleId: readOnlyRole.id,
      active: true,
    },
  });
  console.log(`✓ Created user: ${observer.username} (${observer.name}) - Role: ${readOnlyRole.name}`);

  console.log("\n✅ Seeding complete!");
  console.log(`\n📝 Demo credentials (all users):`);
  console.log(`   Username: admin, manager, cs1, observer`);
  console.log(`   Password: ${demoPassword}`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
