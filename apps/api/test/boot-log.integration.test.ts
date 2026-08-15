import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
 * 绑 0.0.0.0 时 fastify 默认按网卡逐条打 listen 日志，dev 终端一屏噪音。
 * 入口必须收敛到一条。只验启动日志与监听行为，不碰数据库——/healthz 不查库，
 * DATABASE_URL 只需过 zod 校验，不必真实可达。
 */
describe("entrypoint listen logging", () => {
  let child: ChildProcess | undefined;
  let childStdout = "";
  let childStderr = "";
  let workDir: string;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    workDir = mkdtempSync(join(tmpdir(), "insuredesk-boot-log-"));
    writeFileSync(
      join(workDir, ".env"),
      [
        'DATABASE_URL="postgresql://u:p@127.0.0.1:5432/insuredesk?schema=public"',
        'SESSION_SECRET="boot-log-test-secret-at-least-32-chars"',
        'HOST="0.0.0.0"',
        `PORT="${port}"`,
        'NODE_ENV="test"',
        'LOG_LEVEL="info"',
      ].join("\n"),
    );

    const env = { ...process.env };
    delete env.DATABASE_URL;
    child = spawn(process.execPath, [join(apiDir, "src", "index.ts")], {
      cwd: workDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      childStdout += chunk.toString();
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
  }, 90_000);

  afterAll(async () => {
    child?.kill();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("logs exactly one listen line while still binding the configured port", async () => {
    const listenLines = childStdout
      .split("\n")
      .filter((line) => line.includes("Server listening at"));
    expect(listenLines, childStdout).toHaveLength(1);
    expect(listenLines[0]).toContain(String(port));

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
  });
});
