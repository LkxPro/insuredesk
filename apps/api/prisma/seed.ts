import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  DEMO_PASSWORD,
  seedChannels,
  seedDemoTickets,
  seedExternalUserRole,
  seedFactoryRolesAndDemoUsers,
  seedShiftTypes,
  seedSlaPolicies,
  seedTicketCategories,
} from "./seed-data.ts";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL ?? "") });

/**
 * Seed script for development and testing.
 * Creates the factory roles (first initialization only) and one demo user per
 * role. The actual fixture lives in seed-data.ts, shared with the auth tests.
 *
 * Invoked by dev-init.ts on `pnpm dev` when the users table is empty.
 */

async function main() {
  console.log("🌱 Seeding database...");

  const { roles, users } = await seedFactoryRolesAndDemoUsers(prisma);

  for (const role of Object.values(roles)) {
    console.log(`✓ Role: ${role.name}`);
  }
  for (const user of Object.values(users)) {
    console.log(`✓ User: ${user.username} (${user.name})`);
  }

  const externalRole = await seedExternalUserRole(prisma);
  console.log(`✓ External role: ${externalRole.name}`);

  const policies = await seedSlaPolicies(prisma);
  for (const policy of policies) {
    const overdue = policy.overdueHours === null ? "不设超时" : `超时${policy.overdueHours}h`;
    console.log(
      `✓ SLAPolicy: ${policy.complaintLevel}（首响${policy.firstResponseMinutes}min / ${overdue}）`,
    );
  }

  const shifts = await seedShiftTypes(prisma);
  for (const shift of shifts) {
    console.log(`✓ ShiftType: ${shift.name}`);
  }

  const categories = await seedTicketCategories(prisma);
  console.log(`✓ Ticket categories: ${categories.length}`);

  const channels = await seedChannels(prisma);
  console.log(`✓ Channels: ${channels.length}`);

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
