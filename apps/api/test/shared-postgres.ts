import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const TEMPLATE_DB = "harness_template";

declare module "vitest" {
  interface ProvidedContext {
    integrationDbBaseUri: string;
  }
}

export async function migrateDeploy(databaseUrl: string, baseUri: string): Promise<void> {
  const admin = new PrismaClient({ adapter: new PrismaPg(baseUri) });
  try {
    await admin.$transaction(
      async (tx) => {
        // etl_ro 是集群共享角色；各测试库的迁移必须在同一管理库取锁。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261104, 1)`;
        execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
          cwd: apiDir,
          env: { ...process.env, DATABASE_URL: databaseUrl },
          stdio: "pipe",
          // Windows 的 pnpm.cmd 必须由 shell 解析，直接执行会 ENOENT/EINVAL。
          shell: process.platform === "win32",
        });
      },
      { timeout: 180_000 },
    );
  } finally {
    await admin.$disconnect();
  }
}

export function uriForDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function runAdminSql(baseUri: string, sql: string): Promise<void> {
  const admin = new PrismaClient({ adapter: new PrismaPg(baseUri) });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}
