import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * Runs before `tsx watch` on every `pnpm dev`: applies committed migrations
 * and regenerates the Prisma client. Required system catalogs are seeded on
 * every start; destructive demo fixtures still run only into an empty
 * database so a developer's in-progress tickets are never replaced.
 */

// `docker compose up -d` returns before a fresh Postgres volume finishes
// initdb, so retry instead of failing the very first `pnpm dev`.
const MIGRATE_ATTEMPTS = 15;
for (let attempt = 1; ; attempt++) {
  try {
    process.stdout.write(
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "pipe" }),
    );
    break;
  } catch (error) {
    if (attempt === MIGRATE_ATTEMPTS) {
      process.stderr.write(String((error as { stderr?: Buffer }).stderr ?? error));
      console.error("❌ migrate deploy failed — is PostgreSQL up? (docker compose up -d)");
      process.exit(1);
    }
    console.log(`⏳ database not reachable yet, retrying (${attempt}/${MIGRATE_ATTEMPTS})...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// `migrate deploy` (unlike `migrate dev`) never generates the client, so a
// fresh clone would otherwise start with the ungenerated stub.
execFileSync("pnpm", ["exec", "prisma", "generate"], { stdio: "inherit" });

// Imported only after `prisma generate` — a static top-level import would
// load the stub that throws on instantiation.
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../src/generated/prisma/client");
const { seedChannels, seedShiftTypes, seedTicketCategories } = await import("./seed-data");
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL ?? "") });
await seedShiftTypes(prisma);
console.log("✓ Shift types: 4 (created if missing)");
await seedTicketCategories(prisma);
console.log("✓ Ticket categories: 17 (first initialization only)");
await seedChannels(prisma);
console.log("✓ Channels: 4 (first initialization only)");
const userCount = await prisma.user.count();
await prisma.$disconnect();

if (userCount === 0) {
  execFileSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], { stdio: "inherit" });
} else {
  console.log(`✓ ${userCount} users present — skipping seed`);
}
