import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * Runs before `tsx watch` on every `pnpm dev`: applies committed migrations,
 * then seeds — but only into an empty database. A non-empty users table means
 * a developer may be mid-test on the demo tickets; re-seeding would replace
 * them under their feet.
 */

try {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit" });
} catch {
  console.error("❌ migrate deploy failed — is PostgreSQL up? (docker compose up -d)");
  process.exit(1);
}

const prisma = new PrismaClient();
const userCount = await prisma.user.count();
await prisma.$disconnect();

if (userCount === 0) {
  execFileSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], { stdio: "inherit" });
} else {
  console.log(`✓ ${userCount} users present — skipping seed`);
}
