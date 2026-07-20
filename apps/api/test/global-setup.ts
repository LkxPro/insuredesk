import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { migrateDeploy, runAdminSql, TEMPLATE_DB, uriForDatabase } from "./shared-postgres";

const POSTGRES_IMAGE = "postgres:17-alpine";

/**
 * 整个集成测试运行只起这一个 Postgres 容器：template 库迁移一次，各测试文件
 * 在 harness 里克隆它。CREATE DATABASE ... TEMPLATE 要求 template 上没有
 * 存活连接——migrateDeploy 的子进程退场即断连，克隆开始前恰好满足。
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  try {
    const baseUri = container.getConnectionUri();
    await runAdminSql(baseUri, `CREATE DATABASE "${TEMPLATE_DB}"`);
    migrateDeploy(uriForDatabase(baseUri, TEMPLATE_DB));
    project.provide("integrationDbBaseUri", baseUri);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}
