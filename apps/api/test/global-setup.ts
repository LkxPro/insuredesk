import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { migrateDeploy, runAdminSql, TEMPLATE_DB, uriForDatabase } from "./shared-postgres.ts";

const POSTGRES_IMAGE = "postgres:17-alpine";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  try {
    const baseUri = container.getConnectionUri();
    await runAdminSql(baseUri, `CREATE DATABASE "${TEMPLATE_DB}"`);
    await migrateDeploy(uriForDatabase(baseUri, TEMPLATE_DB), baseUri);
    project.provide("integrationDbBaseUri", baseUri);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}
