import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  DEMO_PASSWORD,
  seedComplaintLevels,
  seedDemoTickets,
  seedPresetRolesAndUsers,
  seedSlaPolicies,
} from "./seed-data";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

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

  const policies = await seedSlaPolicies(prisma);
  for (const policy of policies) {
    const overdue = policy.overdueHours === null ? "不设超时" : `超时${policy.overdueHours}h`;
    console.log(
      `✓ SLAPolicy: ${policy.complaintLevel}（首响${policy.firstResponseMinutes}min / ${overdue}）`,
    );
  }

  const levels = await seedComplaintLevels(prisma);
  for (const level of levels) {
    console.log(`✓ ComplaintLevel: ${level.name} (排序${level.sortOrder})`);
  }

  const tickets = await seedDemoTickets(prisma, { roles, users });
  if (tickets.replacedCount > 0) {
    console.log(`✓ Replaced demo tickets: ${tickets.replacedCount}`);
  }
  console.log(`✓ Demo tickets: ${tickets.created.length}`);

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
