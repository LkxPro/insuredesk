import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { releaseClosedRemoteClaims, requeueWithBudget, validateBody } from "./dispatch.ts";
import { DirLock } from "./lock.ts";

const execFileP = promisify(execFile);
const git = (root: string, args: string[]) =>
  execFileP("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

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
    await writeFile(join(path, "pid"), "999999999\n");
    const lock = new DirLock(path);
    assert.equal(await lock.acquire(), true);
    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("锁目录被删或易主后 verify 失败(daemon 据此自杀)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
  try {
    const path = join(dir, ".lock");
    const lock = new DirLock(path);
    assert.equal(await lock.acquire(), true);
    assert.equal(await lock.verify(), true);
    await rm(path, { recursive: true, force: true });
    assert.equal(await lock.verify(), false);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path);
    await writeFile(join(path, "pid"), "999999999\n");
    assert.equal(await lock.verify(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseClosedRemoteClaims 释放关单远端 claim,未关单保留", async () => {
  const origin = await mkdtemp(join(tmpdir(), "claim-origin-"));
  const root = await mkdtemp(join(tmpdir(), "claim-clone-"));
  try {
    await git(origin, ["init", "--bare", "-b", "main"]);
    await git(root, ["init", "-b", "main"]);
    await writeFile(join(root, "f.txt"), "x\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);
    await git(root, ["remote", "add", "origin", origin]);
    await git(root, ["push", "-q", "origin", "main"]);
    const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const claim = async (issue: number, slot: number) => {
      const sha = (
        await git(root, [
          "commit-tree",
          `${head}^{tree}`,
          "-p",
          head,
          "-m",
          `claim issue ${issue} slot ${slot} by 1`,
        ])
      ).stdout.trim();
      await git(root, [
        "push",
        "-q",
        "origin",
        `${sha}:refs/heads/agent-claims/issue-${issue}`,
        `${sha}:refs/heads/agent-slots/${slot}`,
      ]);
    };
    await claim(7, 1);
    await claim(8, 2);
    const released = await releaseClosedRemoteClaims(root, async (n) => n === 7);
    assert.deepEqual(released, [7]);
    const remaining = (await git(root, ["ls-remote", "origin"])).stdout;
    assert.equal(remaining.includes("agent-claims/issue-7"), false);
    assert.equal(remaining.includes("agent-slots/1"), false);
    assert.equal(remaining.includes("agent-claims/issue-8"), true);
    assert.equal(remaining.includes("agent-slots/2"), true);
  } finally {
    await rm(origin, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

async function withGhShim(
  commentsJson: string,
  fn: (capture: () => Promise<string>) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "requeue-test-"));
  const captureFile = join(dir, "gh-calls");
  const gh = join(dir, "gh");
  await writeFile(
    gh,
    `#!/bin/sh
printf '%s\\n' "$*" >>"$CAPTURE"
case "$*" in
  'issue view 7 --json comments --jq .comments') printf '%s\\n' "$COMMENTS" ;;
esac
exit 0
`,
  );
  await chmod(gh, 0o755);
  const saved = {
    gh: process.env.AGENT_LOOP_GH,
    cap: process.env.CAPTURE,
    c: process.env.COMMENTS,
  };
  process.env.AGENT_LOOP_GH = gh;
  process.env.CAPTURE = captureFile;
  process.env.COMMENTS = commentsJson;
  try {
    await fn(() => readFile(captureFile, "utf8"));
  } finally {
    if (saved.gh === undefined) delete process.env.AGENT_LOOP_GH;
    else process.env.AGENT_LOOP_GH = saved.gh;
    if (saved.cap === undefined) delete process.env.CAPTURE;
    else process.env.CAPTURE = saved.cap;
    if (saved.c === undefined) delete process.env.COMMENTS;
    else process.env.COMMENTS = saved.c;
    await rm(dir, { recursive: true, force: true });
  }
}

test("daemon 恢复重排队计入 agent-requeue 预算", async () => {
  await withGhShim("[]", async (capture) => {
    await requeueWithBudget(7, "Recovered an orphaned agent:running label.");
    const calls = await capture();
    assert.ok(calls.includes("issue edit 7 --add-label agent:queued --remove-label agent:running"));
    assert.ok(calls.includes("agent-requeue:1"));
  });
});

test("恢复预算耗尽 → agent:blocked,不再复活", async () => {
  const existing = JSON.stringify([
    { body: "<!-- agent-requeue:1 --> ..." },
    { body: "<!-- agent-requeue:2 --> ..." },
  ]);
  await withGhShim(existing, async (capture) => {
    await requeueWithBudget(7, "Recovered an orphaned agent:running label.");
    const calls = await capture();
    assert.ok(calls.includes("--add-label agent:blocked"));
    assert.ok(calls.includes("Requeue budget (2) exhausted"));
    assert.ok(!calls.includes("--add-label agent:queued"));
  });
});
