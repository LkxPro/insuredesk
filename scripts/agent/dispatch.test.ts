import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateBody } from "./dispatch.ts";
import { DirLock } from "./lock.ts";

const VALID = `## Goal
Do a thing
## Scope
apps/api
## Declared touch-set
- apps/api/**
## Logical locks
- None
## Acceptance criteria
- [ ] works
## Dependencies
- None
## Test plan
- pnpm test
`;

test("合法 body 通过", () => {
  assert.equal(validateBody(VALID), null);
});

test("缺 Dependencies 段", () => {
  const body = VALID.replace(/## Dependencies\n- None\n/, "");
  assert.equal(validateBody(body), "missing required heading: Dependencies");
});

test("验收标准必须有 checkbox", () => {
  const body = VALID.replace("- [ ] works", "- works");
  assert.equal(validateBody(body), "acceptance criteria need at least one checkbox");
});

test("checkbox 必须在 Acceptance criteria 段内", () => {
  const body = VALID.replace("- [ ] works", "works").replace(
    "## Dependencies",
    "## Dependencies\n- [ ] x\n## Goal",
  );
  assert.notEqual(validateBody(body), null);
});

test("touch-set 不能为 None,locks 可以", () => {
  assert.equal(
    validateBody(VALID.replace("- apps/api/**", "- None")),
    "Declared touch-set cannot be None",
  );
  assert.equal(validateBody(VALID.replace("- pnpm test", "- None")), "Test plan cannot be None");
});

test("段列表必须显式", () => {
  const body = VALID.replace("- None\n## Acceptance criteria", "\n## Acceptance criteria");
  assert.equal(validateBody(body), "Logical locks needs an explicit list or - None");
});

test("dispatch/daemon 锁互斥,持有人死后可受让", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
  try {
    const a = new DirLock(join(dir, ".lock"));
    const b = new DirLock(join(dir, ".lock"));
    assert.equal(await a.acquire(), true);
    assert.equal(await b.acquire(), false);
    await a.release();
    assert.equal(await b.acquire(), true);
    await b.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("死持有人的锁被清尸体重置", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
  try {
    const path = join(dir, ".lock");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path);
    // 写一个必死不活的大 pid。
    await writeFile(join(path, "pid"), "999999999\n");
    const lock = new DirLock(path);
    assert.equal(await lock.acquire(), true);
    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
