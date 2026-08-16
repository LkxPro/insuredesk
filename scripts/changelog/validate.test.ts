import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { validateChangelogFile } from "./validate.ts";

const repoRoot = join(import.meta.dirname, "../..");
const fixtures = join(repoRoot, "changelog/fixtures");
const validateEntry = join(import.meta.dirname, "validate.ts");

function runCli(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, [validateEntry, ...args], { cwd, encoding: "utf8" });
}

test("合法 fixture 零错误", () => {
  const errors = validateChangelogFile(join(fixtures, "valid/v2099.01.0.yaml"));
  assert.deepEqual(errors, []);
});

test("非法 category 报 category 并带行号", () => {
  const errors = validateChangelogFile(join(fixtures, "invalid/v2099.02.0.yaml"));
  assert.ok(errors.length > 0);
  assert.ok(
    errors.some((e) => e.message.includes("category")),
    JSON.stringify(errors),
  );
  assert.ok(errors.every((e) => typeof e.line === "number" && e.line >= 1));
});

test("version 与文件名不一致报 version", () => {
  const errors = validateChangelogFile(join(fixtures, "invalid/v2099.03.0.yaml"));
  assert.ok(
    errors.some((e) => e.message.includes("version")),
    JSON.stringify(errors),
  );
});

test("screenshot 引用不存在的 PNG 报 screenshot", () => {
  const errors = validateChangelogFile(join(fixtures, "invalid/v2099.04.0.yaml"));
  assert.ok(
    errors.some((e) => e.message.includes("screenshot")),
    JSON.stringify(errors),
  );
});

test("条目缺 user 报 user", () => {
  const errors = validateChangelogFile(join(fixtures, "invalid/v2099.05.0.yaml"));
  assert.ok(
    errors.some((e) => e.message.includes("user")),
    JSON.stringify(errors),
  );
});

test("CLI：合法 fixture 退出码 0", () => {
  const result = runCli([join(fixtures, "valid/v2099.01.0.yaml")]);
  assert.equal(result.status, 0, result.stderr);
});

test("CLI：非法 fixture 退出码非 0 且输出含字段名", () => {
  for (const [file, field] of [
    ["v2099.02.0.yaml", "category"],
    ["v2099.03.0.yaml", "version"],
    ["v2099.04.0.yaml", "screenshot"],
    ["v2099.05.0.yaml", "user"],
  ] as const) {
    const result = runCli([join(fixtures, "invalid", file)]);
    assert.notEqual(result.status, 0, file);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes(field), `${file}: ${output}`);
  }
});

test("CLI：无参数时校验仓库 changelog/ 顶层文件（暂无真实版本，通过）", () => {
  const result = runCli([]);
  assert.equal(result.status, 0, result.stderr);
});
