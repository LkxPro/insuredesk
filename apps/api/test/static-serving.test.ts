import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.ts";
import { buildServer } from "../src/server.ts";

/**
 * The API doubles as the production web server: in production it serves the
 * built SPA (apps/web/dist) via @fastify/static, with unknown paths falling
 * back to index.html for client-side routing. In development it does none of
 * this — Vite owns the dev server. These tests pin that boundary at
 * buildServer, using a throwaway dist dir so no real build is needed.
 */

const INDEX_HTML = "<!doctype html><html><body><div id=root></div></body></html>";
const ASSET_JS = "console.log('app bundle');";

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "insuredesk-dist-"));
  writeFileSync(join(dir, "index.html"), INDEX_HTML);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), ASSET_JS);
  return dir;
}

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public",
  SESSION_SECRET: "test-secret-at-least-32-characters-long-for-security",
};

describe("production static frontend serving", () => {
  let distDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    distDir = makeDist();
    app = buildServer(parseEnv({ ...baseEnv, NODE_ENV: "production", WEB_DIST_PATH: distDir }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it("serves index.html at the root", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it("serves static assets", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(ASSET_JS);
  });

  it("falls back to index.html for unknown SPA routes", async () => {
    const res = await app.inject({ method: "GET", url: "/tickets/123" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it("keeps the liveness probe working", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("keeps tRPC routes working", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.status).toBe("ok");
  });

  it("returns JSON (not the SPA) for unknown API paths", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/does-not-exist" });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toBe(INDEX_HTML);
    expect(res.headers["content-type"]).toContain("application/json");
  });
});

describe("development mode leaves static serving to Vite", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer(parseEnv({ ...baseEnv, NODE_ENV: "development" }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("does not serve an SPA shell — unknown routes 404 as JSON", async () => {
    const res = await app.inject({ method: "GET", url: "/tickets/123" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("<div id=root>");
  });
});
