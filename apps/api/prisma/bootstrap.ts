import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { bootstrapSystemData } from "./seed-data";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const MIN_PASSWORD_LENGTH = 8;

const prisma = new PrismaClient();

/**
 * Production first-install bootstrap: preset roles, default SLA policies, and
 * one admin account. Idempotent — safe to re-run; never touches an existing
 * user. The demo fixtures stay in seed.ts (dev only).
 *
 * Run with: pnpm db:bootstrap
 */

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `❌ ADMIN_INITIAL_PASSWORD must be set (min ${MIN_PASSWORD_LENGTH} chars). Add it to the server-side .env before running db:bootstrap; you can remove it again once bootstrap has completed.`,
    );
    process.exit(1);
  }

  console.log("🚀 Bootstrapping system data...");
  const { adminCreated } = await bootstrapSystemData(prisma, {
    adminUsername: username,
    adminPassword: password,
  });

  console.log("✓ Preset roles: 4 (upserted)");
  console.log("✓ SLA policies: 4 (created if missing)");
  console.log(
    adminCreated
      ? `✓ Admin account "${username}" created — log in and change the password in 用户管理 if needed`
      : `✓ Admin account "${username}" already exists — left untouched`,
  );
  console.log("\n✅ Bootstrap complete!");
}

main()
  .catch((e) => {
    console.error("❌ Bootstrap failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
