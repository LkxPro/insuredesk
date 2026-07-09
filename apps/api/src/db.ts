import { PrismaClient } from "@prisma/client";

/**
 * Canonical Prisma client for the API. Reads DATABASE_URL from the (already
 * validated) environment. Repositories and future DB-backed procedures import
 * this single instance; the integration test drives it against a real Postgres.
 */
export const prisma = new PrismaClient();
