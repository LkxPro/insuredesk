import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

let client: PrismaClient | undefined;

function initClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — put it in process.env (apps/api/.env in dev) before using the database",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg(url) });
}

/**
 * Canonical Prisma client for the API. Repositories and DB-backed procedures
 * import this single instance; the integration tests drive it against a real
 * Postgres. Constructed lazily on first property access so importing this
 * module never depends on env-loading order, and a missing DATABASE_URL fails
 * with a clear error here instead of a SASL failure on the first query (pg
 * silently falls back to libpq defaults when given an empty string).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    client ??= initClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
