import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { runAdminSql, TEMPLATE_DB, uriForDatabase } from "./shared-postgres";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 集成测试共享容器统一使用的 Postgres 镜像。 */
const POSTGRES_IMAGE = "postgres:17-alpine";

/**
 * 整个集成测试运行只起这一个 Postgres 容器：template 库迁移一次，各测试文件
 * 在 harness 里克隆它。migrate deploy 以子进程跑完即退，保证克隆开始时
 * template 上没有存活连接（有连接时 CREATE DATABASE ... TEMPLATE 会失败）。
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  try {
    const baseUri = container.getConnectionUri();
    await runAdminSql(baseUri, `CREATE DATABASE "${TEMPLATE_DB}"`);
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: uriForDatabase(baseUri, TEMPLATE_DB) },
      stdio: "pipe",
    });
    project.provide("integrationDbBaseUri", baseUri);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}
