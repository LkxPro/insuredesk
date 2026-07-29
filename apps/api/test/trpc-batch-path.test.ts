import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../src/env";
import { buildServer } from "../src/server";

/**
 * httpBatchLink puts every procedure name of a batch into ONE path segment, so
 * the route param grows with the batch. Fastify's 100-char default answers
 * anything longer with a 414 whose body is NOT a tRPC envelope — the client then
 * throws "Unable to transform response from server", naming neither the real
 * cause nor the offending procedure. Intermittent by nature: it only fires when
 * enough queries happen to land in the same batch window.
 */

const env = parseEnv({
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public",
  SESSION_SECRET: "test-secret-at-least-32-characters-long-for-security",
  NODE_ENV: "test",
});

/** 工单管理's first paint, verbatim — 111 chars, the batch that reported the bug. */
const TICKETS_PAGE_BATCH = [
  "notification.list",
  "ticket.list",
  "channel.filterOptions",
  "ticketCategory.filterOptions",
  "completionStatus.filterOptions",
].join(",");

describe("tRPC batch request path length", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer(env);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("routes 工单管理's opening batch instead of rejecting the path", async () => {
    expect(TICKETS_PAGE_BATCH.length).toBeGreaterThan(100);

    const res = await app.inject({
      method: "GET",
      url: `/trpc/${TICKETS_PAGE_BATCH}?batch=1&input=%7B%7D`,
    });

    expect(res.statusCode).not.toBe(414);
    // Unauthenticated, so every entry errors — the point is that it's a tRPC
    // envelope the client can transform, not Fastify's own error shape.
    expect(JSON.parse(res.body)).toHaveLength(5);
  });

  it("keeps routing as batches grow", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/trpc/${Array(40).fill("ticket.list").join(",")}?batch=1&input=%7B%7D`,
    });

    expect(res.statusCode).not.toBe(414);
  });
});
