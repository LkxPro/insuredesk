import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { bootstrapSystemData } from "./seed-data";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const prisma = new PrismaClient();

/**
 * Production bootstrap: factory roles (first initialization only), default
 * SLA policies, shift definitions, and one admin account (admin/admin — the
 * operator must change the password right after first deploy). Runs on every production container
 * start, after `prisma migrate deploy`. Re-runs never touch existing roles or
 * users. The demo fixtures stay in seed.ts (dev only).
 */

async function main() {
  console.log("🚀 Bootstrapping system data...");
  const { adminCreated, rolesCreated } = await bootstrapSystemData(prisma, {
    adminUsername: "admin",
    adminPassword: "admin",
  });

  console.log(
    rolesCreated
      ? "✓ Factory roles created (first initialization)"
      : "✓ Roles already initialized — left untouched",
  );
  console.log("✓ SLA policies: 4 (created if missing)");
  console.log("✓ Shift types: 4 (created if missing)");
  console.log("✓ Ticket categories: 17 (first initialization only)");
  console.log(
    adminCreated
      ? '✓ Admin account "admin" created with the default password — change it in 用户管理 immediately'
      : '✓ Admin account "admin" already exists — left untouched',
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
