import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { renderNotes } from "./render-notes.ts";

const repoRoot = join(import.meta.dirname, "../..");
const entry = join(import.meta.dirname, "render-notes.ts");
const fixtures = join(repoRoot, "changelog/fixtures");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [entry, ...args], { cwd: repoRoot, encoding: "utf8" });
}

const FIXTURE_NOTES = `## 新增

- 工单列表页新增渠道筛选器，支持多选与清空，筛选条件随导出生效。

## 改进

- 排班页改为按周懒加载，首屏只渲染当周数据。

## 修复

- 修复批量导出在含多值字段时列错位的问题。

## 内部

- 升级内部依赖版本，无用户可见变化。
`;

test("renderNotes：合法 fixture 按 新增/改进/修复/内部 分组渲染 full 字段", () => {
  const notes = renderNotes({
    version: "v2099.01.0",
    date: "2099-01-15",
    entries: [
      {
        category: "新增",
        user: "工单列表支持按渠道筛选",
        full: "工单列表页新增渠道筛选器，支持多选与清空，筛选条件随导出生效。",
        page: "/tickets",
        screenshot: "tickets-filter.png",
      },
      {
        category: "改进",
        user: "排班页加载更快",
        full: "排班页改为按周懒加载，首屏只渲染当周数据。",
      },
      { category: "修复", user: "导出列错位", full: "修复批量导出在含多值字段时列错位的问题。" },
      { category: "内部", user: "升级依赖", full: "升级内部依赖版本，无用户可见变化。" },
    ],
  });
  assert.equal(notes, FIXTURE_NOTES);
});

test("renderNotes：无条目的分类省略，分类顺序固定而非 yaml 顺序", () => {
  const notes = renderNotes({
    version: "v2099.02.0",
    date: "2099-02-01",
    entries: [
      { category: "内部", user: "a", full: "内部先行。" },
      { category: "新增", user: "b", full: "新增随后。" },
    ],
  });
  assert.equal(notes, "## 新增\n\n- 新增随后。\n\n## 内部\n\n- 内部先行。\n");
});

test("renderNotes：同分类多条按 yaml 顺序平铺", () => {
  const notes = renderNotes({
    version: "v2099.03.0",
    date: "2099-03-01",
    entries: [
      { category: "修复", user: "a", full: "第一条修复。" },
      { category: "修复", user: "b", full: "第二条修复。" },
    ],
  });
  assert.equal(notes, "## 修复\n\n- 第一条修复。\n- 第二条修复。\n");
});

test("CLI：无参数报用法并退出 1", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("用法"), result.stderr);
});

test("CLI：yaml 不存在退出 1 且报路径", () => {
  const result = runCli(["changelog/v9999.01.0.yaml"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("v9999.01.0.yaml"), result.stderr);
});

test("CLI：校验器不通过退出 1 且报字段错误", () => {
  const result = runCli([join(fixtures, "invalid/v2099.02.0.yaml")]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("category"), result.stderr);
});

test("CLI：合法 fixture 原样渲染到 stdout", () => {
  const result = runCli([join(fixtures, "valid/v2099.01.0.yaml")]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, FIXTURE_NOTES);
});
