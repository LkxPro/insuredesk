import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { cleanupClosedIssue, killLiveWorker, validateBody } from "./dispatch.ts";
import { DirLock, pidAlive } from "./lock.ts";

const execFileP = promisify(execFile);
const git = (root: string, args: string[]) =>
  execFileP("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

async function repoWithWorktree(issue: number) {
  const root = await mkdtemp(join(tmpdir(), "cleanup-test-"));
  await git(root, ["init", "-b", "main"]);
  await writeFile(join(root, "f.txt"), "x\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "init"]);
  const worktrees = join(root, ".worktrees");
  const path = join(worktrees, `issue-${issue}`);
  await git(root, ["worktree", "add", "-b", `codex/issue-${issue}`, path, "main"]);
  return { root, worktrees, path };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

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

test("cleanupClosedIssue 清正常 worktree、分支与产物", async () => {
  const { root, worktrees, path } = await repoWithWorktree(1);
  try {
    await writeFile(join(worktrees, "issue-1.pid"), "1\n");
    await writeFile(join(worktrees, "issue-1.killing"), "1\n");
    await writeFile(join(worktrees, "issue-1.log"), "log\n");
    await cleanupClosedIssue(root, worktrees, 1, path);
    assert.equal(await exists(path), false);
    await assert.rejects(
      git(root, ["show-ref", "--verify", "--quiet", "refs/heads/codex/issue-1"]),
    );
    assert.equal(await exists(join(worktrees, "issue-1.pid")), false);
    assert.equal(await exists(join(worktrees, "issue-1.killing")), false);
    assert.equal(await exists(join(worktrees, "issue-1.log")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupClosedIssue 注册缺失只剩目录壳:不抛且壳被清", async () => {
  const { root, worktrees, path } = await repoWithWorktree(2);
  try {
    // 模拟带外清除:git 侧注册没了,目录壳还在。
    await rm(join(root, ".git", "worktrees", "issue-2"), { recursive: true, force: true });
    await cleanupClosedIssue(root, worktrees, 2, path);
    assert.equal(await exists(path), false);
    await assert.rejects(
      git(root, ["show-ref", "--verify", "--quiet", "refs/heads/codex/issue-2"]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("killLiveWorker 首轮 SIGTERM,同 pid 次轮升 SIGKILL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kill-test-"));
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.stdout.write('ready\\n')",
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  child.unref();
  const pid = child.pid;
  assert.ok(pid !== undefined);
  // 等子进程装上 SIGTERM handler,否则信号按默认动作杀死它。
  await new Promise<void>((resolve) => {
    child.stdout?.setEncoding("utf8").on("data", () => resolve());
  });
  try {
    await writeFile(join(dir, "issue-7.pid"), `${pid}\n`);
    await killLiveWorker(dir, 7);
    assert.equal(pidAlive(pid), true);
    assert.equal((await readFile(join(dir, "issue-7.killing"), "utf8")).trim(), String(pid));
    await killLiveWorker(dir, 7);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(pidAlive(pid), false);
  } finally {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});
