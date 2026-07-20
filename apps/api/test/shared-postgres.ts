import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * global setup 里迁移完成后作为克隆源的 template 库名。template 只含 schema
 * 不含种子数据：无种子声明的测试（如 bootstrap）要求拿到数据为空的库，种子
 * 按各文件声明灌进各自的克隆。
 */
export const TEMPLATE_DB = "harness_template";

declare module "vitest" {
  interface ProvidedContext {
    /** 共享容器管理库（默认库）的连接串；harness 由此派生各克隆库的连接。 */
    integrationDbBaseUri: string;
  }
}

/** 对目标库真跑 `prisma migrate deploy`；子进程跑完即退，不在库上留连接。 */
export function migrateDeploy(databaseUrl: string): void {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

/** 把管理库连接串改指到 dbName。 */
export function uriForDatabase(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * 在共享容器的管理库上执行单条 DDL。CREATE/DROP DATABASE 不能进事务，也不能
 * 从连着源库/目标库的会话发出，所以走独立的管理库连接、用完即断。
 */
export async function runAdminSql(baseUri: string, sql: string): Promise<void> {
  const admin = new PrismaClient({ adapter: new PrismaPg(baseUri) });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}
