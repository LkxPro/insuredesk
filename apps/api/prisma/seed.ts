import { PrismaClient } from "@prisma/client";
import { DEMO_PASSWORD, seedPresetRolesAndUsers } from "./seed-data";

const prisma = new PrismaClient();

/**
 * Seed script for development and testing.
 * Creates the 4 preset roles and sample users for each role.
 * The actual fixture lives in seed-data.ts, shared with the auth tests.
 *
 * Run with: pnpm prisma db seed
 */

async function main() {
  console.log("🌱 Seeding database...");

  const { roles, users } = await seedPresetRolesAndUsers(prisma);

  for (const role of Object.values(roles)) {
    console.log(`✓ Role: ${role.name}`);
  }
  for (const user of Object.values(users)) {
    console.log(`✓ User: ${user.username} (${user.name})`);
  }

  console.log("\n✅ Seeding complete!");
  console.log("\n📝 Demo credentials (all users):");
  console.log(
    `   Username: ${Object.values(users)
      .map((u) => u.username)
      .join(", ")}`,
  );
  console.log(`   Password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
