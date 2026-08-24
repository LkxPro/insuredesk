import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { baseBranchOf, ensureSpecBranch, finalizeSpecs, planParentOf } from "./spec.ts";

const run = promisify(execFile);
const git = (cwd: string, args: string[]) =>
  run("git", ["-C", cwd, ...args]).then((r) => r.stdout.trim());

test("plan marker 解析:parent、parentless、缺失", () => {
  assert.equal(planParentOf("<!-- agent-plan:100:my-key -->\nPart of #100."), 100);
  assert.equal(baseBranchOf("<!-- agent-plan:100:my-key -->\n"), "agent/spec-100");
  assert.equal(planParentOf("<!-- agent-plan:0:solo-fix -->\n"), 0);
  assert.equal(baseBranchOf("<!-- agent-plan:0:solo-fix -->\n"), "main");
  assert.equal(planParentOf("## Goal\n手写票"), 0);
  assert.equal(baseBranchOf(undefined), "main");
});

async function makeRepo(): Promise<{ dir: string; origin: string; root: string }> {
  const dir = await mkdtemp(join(tmpdir(), "spec-test-"));
  const origin = join(dir, "origin.git");
  const root = join(dir, "root");
  await run("git", ["init", "--bare", "-q", origin]);
  await run("git", ["init", "-q", root]);
  await git(root, ["config", "user.name", "t"]);
  await git(root, ["config", "user.email", "t@t"]);
  await writeFile(join(root, "base.txt"), "base\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "base"]);
  await git(root, ["branch", "-M", "main"]);
  await git(root, ["remote", "add", "origin", origin]);
  await git(root, ["push", "-q", "-u", "origin", "main"]);
  return { dir, origin, root };
}

test("ensureSpecBranch 从 origin/main 建支并 fetch;已存在则不动", async () => {
  const { dir, origin, root } = await makeRepo();
  try {
    await ensureSpecBranch(root, "agent/spec-100");
    const mainTip = await git(origin, ["rev-parse", "main"]);
    assert.equal(await git(origin, ["rev-parse", "agent/spec-100"]), mainTip);
    assert.equal(await git(root, ["rev-parse", "origin/agent/spec-100"]), mainTip);

    await git(root, ["checkout", "-qb", "agent/spec-200"]);
    await writeFile(join(root, "child.txt"), "child\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-qm", "child"]);
    await git(root, ["push", "-q", "origin", "agent/spec-200"]);
    await git(root, ["checkout", "-q", "main"]);
    const tip = await git(origin, ["rev-parse", "agent/spec-200"]);
    await ensureSpecBranch(root, "agent/spec-200");
    assert.equal(await git(origin, ["rev-parse", "agent/spec-200"]), tip);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

interface Fixture {
  subIssues: string;
  openBasePrs?: string;
  openHeadPr?: string;
  mergedChildPr?: string;
  blocked?: boolean;
}

async function withGh(
  fixture: Fixture,
  fn: (capture: () => Promise<string>) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "spec-gh-"));
  const captureFile = join(dir, "capture");
  const gh = join(dir, "gh");
  const labels = fixture.blocked
    ? '[{"name":"agent:spec"},{"name":"agent:blocked"}]'
    : '[{"name":"agent:spec"}]';
  await writeFile(
    gh,
    `#!/bin/sh
printf '%s\\n' "$*" >>"$CAPTURE"
case "$*" in
  'issue list --label agent:spec --state open --limit 100 --json number,title,labels')
    printf '[{"number":100,"title":"Big spec","labels":${labels}}]\\n' ;;
  api\\ repos/*/issues/100/sub_issues\\ *)
    printf '%s\\n' '${fixture.subIssues}' ;;
  'pr list --base agent/spec-100 --state open --json number')
    printf '%s\\n' '${fixture.openBasePrs ?? "[]"}' ;;
  'pr list --head agent/spec-100 --state open --json number,body')
    printf '%s\\n' '${fixture.openHeadPr ?? "[]"}' ;;
  'pr list --head codex/issue-101 --state merged --json number --limit 1')
    printf '%s\\n' '${fixture.mergedChildPr ?? "[]"}' ;;
  'issue view 100 --json comments --jq .comments')
    if grep -q 'agent-spec-anomaly' "$CAPTURE" 2>/dev/null; then
      printf '[{"body":"<!-- agent-spec-anomaly:101 --> x"}]\\n'
    else
      printf '[]\\n'
    fi ;;
  'pr create'*) printf 'https://example.test/pull/55\\n' ;;
esac
exit 0
`,
  );
  await chmod(gh, 0o755);
  const saved = { gh: process.env.AGENT_LOOP_GH, cap: process.env.CAPTURE };
  process.env.AGENT_LOOP_GH = gh;
  process.env.CAPTURE = captureFile;
  try {
    await fn(() => readFile(captureFile, "utf8"));
  } finally {
    if (saved.gh === undefined) delete process.env.AGENT_LOOP_GH;
    else process.env.AGENT_LOOP_GH = saved.gh;
    if (saved.cap === undefined) delete process.env.CAPTURE;
    else process.env.CAPTURE = saved.cap;
    await rm(dir, { recursive: true, force: true });
  }
}

async function pushSpecBranch(root: string, file: string, content: string): Promise<void> {
  await git(root, ["checkout", "-qb", "agent/spec-100"]);
  await writeFile(join(root, file), content);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "child slice"]);
  await git(root, ["push", "-q", "origin", "agent/spec-100"]);
  await git(root, ["checkout", "-q", "main"]);
}

test("finalize:全部子票关闭 → 合并 main 并开 final PR(无 automerge),父 issue 收到通知", async () => {
  const { dir, origin, root } = await makeRepo();
  try {
    await pushSpecBranch(root, "child.txt", "child\n");
    await writeFile(join(root, "main-only.txt"), "main\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-qm", "main moved"]);
    await git(root, ["push", "-q", "origin", "main"]);

    await withGh({ subIssues: "101\tCLOSED\tFirst slice" }, async (capture) => {
      await finalizeSpecs(root);
      const calls = await capture();
      assert.ok(
        calls.includes("pr create --base main --head agent/spec-100 --title Spec: Big spec (#100)"),
      );
      assert.ok(calls.includes("Closes #100"));
      assert.ok(calls.includes("- #101 First slice"));
      assert.ok(!calls.includes("agent:automerge"));
      assert.ok(calls.includes("issue comment 100"));
    });
    // main 已分叉,收尾必须产生真正的 merge commit 并推回 spec 分支。
    const parents = await git(origin, ["rev-list", "--parents", "-n", "1", "agent/spec-100"]);
    assert.equal(parents.split(" ").length, 3);
    assert.equal((await git(origin, ["worktree", "list"])).includes("spec-finalize"), false);
    assert.equal((await git(root, ["worktree", "list"])).includes("spec-finalize"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize:main 冲突 → 父 issue agent:blocked + 评论,不开 PR", async () => {
  const { dir, root } = await makeRepo();
  try {
    await pushSpecBranch(root, "base.txt", "spec\n");
    await writeFile(join(root, "base.txt"), "main\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-qm", "main conflict"]);
    await git(root, ["push", "-q", "origin", "main"]);

    await withGh({ subIssues: "101\tCLOSED\tFirst slice" }, async (capture) => {
      await finalizeSpecs(root);
      const calls = await capture();
      assert.ok(calls.includes("issue edit 100 --add-label agent:blocked"));
      assert.ok(!calls.includes("pr create"));
    });
    assert.equal((await git(root, ["worktree", "list"])).includes("spec-finalize"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize:有 open 子票 → 跳过;子 PR 已合并但 issue 未关 → 报一次异常", async () => {
  const { dir, root } = await makeRepo();
  try {
    await pushSpecBranch(root, "child.txt", "child\n");
    await withGh(
      { subIssues: "101\tOPEN\tFirst slice", mergedChildPr: '[{"number":42}]' },
      async (capture) => {
        await finalizeSpecs(root);
        await finalizeSpecs(root);
        const calls = await capture();
        assert.ok(!calls.includes("pr create"));
        const anomalies = calls
          .split("\n")
          .filter((line) => line.includes("agent-spec-anomaly:101"));
        assert.equal(anomalies.length, 1);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize:在途子 PR(base=spec)→ 跳过", async () => {
  const { dir, root } = await makeRepo();
  try {
    await pushSpecBranch(root, "child.txt", "child\n");
    await withGh(
      { subIssues: "101\tCLOSED\tFirst slice", openBasePrs: '[{"number":43}]' },
      async (capture) => {
        await finalizeSpecs(root);
        const calls = await capture();
        assert.ok(!calls.includes("pr create"));
        assert.ok(!calls.includes("issue comment 100"));
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize:final PR 已开且 body 过期 → 只刷 body,不再 merge main", async () => {
  const { dir, origin, root } = await makeRepo();
  try {
    await pushSpecBranch(root, "child.txt", "child\n");
    const tipBefore = await git(origin, ["rev-parse", "agent/spec-100"]);
    await withGh(
      {
        subIssues: "101\tCLOSED\tFirst slice\n102\tCLOSED\tSecond slice",
        openHeadPr: '[{"number":55,"body":"stale"}]',
      },
      async (capture) => {
        await finalizeSpecs(root);
        const calls = await capture();
        assert.ok(!calls.includes("pr create"));
        assert.ok(calls.includes("pr edit 55 --body"));
        assert.ok(calls.includes("- #102 Second slice"));
      },
    );
    assert.equal(await git(origin, ["rev-parse", "agent/spec-100"]), tipBefore);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize:父 issue 已 blocked → 整体跳过", async () => {
  const { dir, root } = await makeRepo();
  try {
    await pushSpecBranch(root, "child.txt", "child\n");
    await withGh({ subIssues: "101\tCLOSED\tFirst slice", blocked: true }, async (capture) => {
      await finalizeSpecs(root);
      const calls = await capture();
      assert.ok(!calls.includes("pr create"));
      assert.ok(!calls.includes("sub_issues"));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
