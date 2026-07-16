import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env; keep `pnpm db:migrate` working standalone.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Left undefined when DATABASE_URL is absent so datasource-free commands
  // (`prisma generate` in CI) still run.
  datasource: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : undefined,
});
