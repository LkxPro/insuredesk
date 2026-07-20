import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => res(port));
    });
  });
}

/**
 * Boots the real entrypoint (src/index.ts) the way `pnpm dev` does: the
 * database URL exists only in a `.env` file in the working directory, never in
 * the parent environment. Module-level singletons (src/db.ts) read process.env
 * while imports are still being evaluated, so the entrypoint must get `.env`
 * into process.env before any app module — buildServer-based tests can't see
 * this ordering, only a spawned boot can.
 */
describe("entrypoint boot with .env-only configuration", () => {
  let harness: IntegrationHarness;
  let child: ChildProcess | undefined;
  let childStderr = "";
  let workDir: string;
  let port: number;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    const databaseUrl = harness.databaseUrl;

    port = await freePort();
    workDir = mkdtempSync(join(tmpdir(), "insuredesk-boot-"));
    writeFileSync(
      join(workDir, ".env"),
      [
        `DATABASE_URL="${databaseUrl}"`,
        'SESSION_SECRET="boot-test-secret-at-least-32-characters-long"',
        'HOST="127.0.0.1"',
        `PORT="${port}"`,
        'NODE_ENV="test"',
        'LOG_LEVEL="silent"',
      ].join("\n"),
    );

    const env = { ...process.env };
    delete env.DATABASE_URL;
    child = spawn(join(apiDir, "node_modules", ".bin", "tsx"), [join(apiDir, "src", "index.ts")], {
      cwd: workDir,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      childStderr += chunk.toString();
    });

    const deadline = Date.now() + 60_000;
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`entrypoint exited with code ${child.exitCode}:\n${childStderr}`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (res.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`server never became ready:\n${childStderr}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }, 180_000);

  afterAll(async () => {
    child?.kill();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    await harness?.stop();
  });

  it("logs in against the database configured in .env", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: DEMO_PASSWORD }),
    });
    const body = (await res.json()) as { success?: boolean };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
  });
});
