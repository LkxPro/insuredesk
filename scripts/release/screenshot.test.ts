import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isDevStackRunning, resolveBaseURL } from "./dev-stack.ts";
import { selectScreenshotTargets, setupScriptFor } from "./screenshot.ts";

const repoRoot = join(import.meta.dirname, "../..");
const screenshotEntry = join(import.meta.dirname, "screenshot.ts");
const fixtureYaml = join(repoRoot, "changelog/fixtures/screenshot/v2099.06.0.yaml");
const fixtureOutDir = join(repoRoot, "changelog/fixtures/screenshot/v2099.06.0");
const setupMarker = join(tmpdir(), "insuredesk-screenshot-setup-v2099.06.0.json");

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [screenshotEntry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 300_000,
  });
}

function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("只筛出同时带 page 与 screenshot 的条目", () => {
  const targets = selectScreenshotTargets(
    [
      { category: "新增", user: "a", full: "a", page: "/tickets", screenshot: "a.png" },
      { category: "改进", user: "b", full: "b", page: "/schedule" },
      { category: "修复", user: "c", full: "c", screenshot: "c.png" },
      { category: "内部", user: "d", full: "d" },
    ],
    "/out",
  );
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.screenshot, "a.png");
  assert.equal(targets[0]?.outputPath, join("/out", "a.png"));
});

test("setup 钩子按 screenshot 同名 .setup.ts 发现", () => {
  const dir = join(tmpdir(), `screenshot-setup-detect-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "a.setup.ts"), "");
    assert.equal(setupScriptFor(dir, "a.png"), join(dir, "a.setup.ts"));
    assert.equal(setupScriptFor(dir, "b.png"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI：无参数报用法并退出 1", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("用法"), result.stderr);
});

test("CLI：yaml 不存在退出 1 且报路径", () => {
  const result = runCli(["changelog/nope/v9999.01.0.yaml"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("v9999.01.0.yaml"), result.stderr);
});

test("CLI：dev 栈未运行时报错提示 make dev", async () => {
  const down = "http://127.0.0.1:1";
  assert.equal(await isDevStackRunning(down), false);
  const result = runCli([fixtureYaml], { SCREENSHOT_BASE_URL: down });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("make dev"), result.stderr);
});

test("端到端：2 条 page 条目产出 2 张 2560x1600 PNG，setup 先于截图，重跑幂等", async (t) => {
  const baseURL = resolveBaseURL();
  if (!(await isDevStackRunning(baseURL))) {
    t.skip(`dev 栈未运行（${baseURL}），先 make dev`);
    return;
  }

  rmSync(setupMarker, { force: true });
  const first = runCli([fixtureYaml]);
  assert.equal(first.status, 0, first.stderr);

  const shots = ["tickets-list.png", "schedule.png"];
  for (const name of shots) {
    const path = join(fixtureOutDir, name);
    assert.ok(existsSync(path), name);
    assert.ok(statSync(path).size > 0, name);
    assert.deepEqual(pngSize(path), { width: 2560, height: 1600 }, name);
  }

  assert.ok(existsSync(setupMarker), "setup 钩子未执行");
  const marker = JSON.parse(readFileSync(setupMarker, "utf8"));
  assert.ok(marker.webUrl, "setup 未拿到 INSUREDESK_WEB_URL");
  const ticketsShot = statSync(join(fixtureOutDir, "tickets-list.png"));
  assert.ok(
    marker.ranAt <= ticketsShot.mtimeMs,
    `setup(${marker.ranAt}) 晚于截图(${ticketsShot.mtimeMs})`,
  );

  const before = new Map(shots.map((n) => [n, statSync(join(fixtureOutDir, n)).mtimeMs]));
  const listingBefore = readdirSync(fixtureOutDir).sort();

  const second = runCli([fixtureYaml]);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(readdirSync(fixtureOutDir).sort(), listingBefore, "重跑残留多余文件");
  for (const name of shots) {
    const after = statSync(join(fixtureOutDir, name)).mtimeMs;
    assert.ok(after > (before.get(name) ?? 0), `${name} 未被覆盖重截`);
  }
});
