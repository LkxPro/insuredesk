import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reconcileOpenPrs } from "./dispatch.ts";

interface SweepEnv {
  PRS?: string;
  ISSUE7?: string;
  COMMENTS7?: string;
  TASKS?: string;
  STATE7?: string;
  MERGED7?: string;
  PRSTATE?: string;
}

const issue = (labels: string[]) =>
  JSON.stringify({
    number: 7,
    state: "OPEN",
    body: "",
    labels: labels.map((name) => ({ name })),
  });

const pr = (over: Record<string, unknown>) =>
  JSON.stringify([
    {
      number: 44,
      headRefName: "codex/issue-7",
      updatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      labels: [{ name: "agent:automerge" }],
      statusCheckRollup: [
        { name: "static", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "merge-and-close", status: "COMPLETED", conclusion: "CANCELLED" },
      ],
      ...over,
    },
  ]);

async function withSweepShim(
  env: SweepEnv,
  fn: (capture: () => Promise<string>) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sweep-test-"));
  const captureFile = join(dir, "gh-calls");
  const gh = join(dir, "gh");
  await writeFile(
    gh,
    `#!/bin/sh
printf '%s\\n' "$*" >>"$CAPTURE"
case "$*" in
  'pr list --state open --limit 100 --json number,headRefName,labels,updatedAt,statusCheckRollup') printf '%s\\n' "$PRS" ;;
  'issue view 7 --json number,state,body,labels') printf '%s\\n' "$ISSUE7" ;;
  'issue view 7 --json comments --jq .comments') printf '%s\\n' "$COMMENTS7" ;;
  'issue list --label agent:task --state open --limit 100 --json number,labels') printf '%s\\n' "$TASKS" ;;
  'issue view 7 --json state --jq .state') printf '%s\\n' "$STATE7" ;;
  'pr list --head codex/issue-7 --state merged --json number') printf '%s\\n' "$MERGED7" ;;
  'pr view 44 --json state') printf '%s\\n' "$PRSTATE" ;;
  'pr view 44 --json comments --jq .comments') printf '[]\\n' ;;
esac
exit 0
`,
  );
  await chmod(gh, 0o755);
  const keys = [
    "AGENT_LOOP_GH",
    "CAPTURE",
    "PRS",
    "ISSUE7",
    "COMMENTS7",
    "TASKS",
    "STATE7",
    "MERGED7",
    "PRSTATE",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.AGENT_LOOP_GH = gh;
  process.env.CAPTURE = captureFile;
  process.env.PRS = env.PRS ?? "[]";
  process.env.ISSUE7 = env.ISSUE7 ?? issue(["agent:task"]);
  process.env.COMMENTS7 = env.COMMENTS7 ?? "[]";
  process.env.TASKS = env.TASKS ?? "[]";
  process.env.STATE7 = env.STATE7 ?? "OPEN";
  process.env.MERGED7 = env.MERGED7 ?? "[]";
  process.env.PRSTATE = env.PRSTATE ?? JSON.stringify({ state: "OPEN" });
  try {
    await fn(() => readFile(captureFile, "utf8"));
  } finally {
    for (const k of keys)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    await rm(dir, { recursive: true, force: true });
  }
}

const redPr = pr({
  statusCheckRollup: [
    { name: "static", status: "COMPLETED", conclusion: "FAILURE" },
    { name: "merge-and-close", status: "COMPLETED", conclusion: "CANCELLED" },
  ],
});

test("sweep 红 check + automerge + 无 repair 标 → 回队,label 先于评论", async () => {
  await withSweepShim({ PRS: redPr }, async (capture) => {
    await reconcileOpenPrs();
    const calls = await capture();
    assert.ok(calls.includes("--add-label agent:repair,agent:queued,ready-for-agent"));
    assert.ok(calls.includes("agent-attempts:1"));
    assert.ok(
      calls.indexOf("--add-label agent:repair") < calls.indexOf("agent-attempts:1"),
      "label 必须先于计数评论(乐观锁)",
    );
  });
});

test("sweep 红 check + 已有 repair 标 → 不重复回队", async () => {
  await withSweepShim(
    { PRS: redPr, ISSUE7: issue(["agent:task", "agent:repair"]) },
    async (capture) => {
      await reconcileOpenPrs();
      const calls = await capture();
      assert.ok(!calls.includes("--add-label agent:repair"));
      assert.ok(!calls.includes("agent-attempts"));
    },
  );
});

test("sweep 红 check + blocked 票 → 完全不碰(防每 tick 刷屏)", async () => {
  await withSweepShim(
    { PRS: redPr, ISSUE7: issue(["agent:task", "agent:blocked"]) },
    async (capture) => {
      await reconcileOpenPrs();
      const calls = await capture();
      assert.ok(!calls.includes("issue edit"));
      assert.ok(!calls.includes("issue comment"));
    },
  );
});

test("sweep 红 check 但 PR 无 automerge → 不动(贴标前窗口由 running 跳过与续跑覆盖)", async () => {
  await withSweepShim(
    {
      PRS: pr({
        labels: [],
        statusCheckRollup: [{ name: "static", status: "COMPLETED", conclusion: "FAILURE" }],
      }),
    },
    async (capture) => {
      await reconcileOpenPrs();
      const calls = await capture();
      assert.ok(!calls.includes("--add-label agent:repair"));
    },
  );
});

test("sweep 全绿滞留超阈值 + automerge → 补 squash merge(merge-and-close 取消不计红)", async () => {
  await withSweepShim({ PRS: pr({}) }, async (capture) => {
    await reconcileOpenPrs();
    const calls = await capture();
    assert.ok(calls.includes("pr merge 44 --squash"));
  });
});

test("sweep 全绿但未过阈值 → 不补 merge", async () => {
  await withSweepShim({ PRS: pr({ updatedAt: new Date().toISOString() }) }, async (capture) => {
    await reconcileOpenPrs();
    const calls = await capture();
    assert.ok(!calls.includes("pr merge"));
  });
});

test("merged-but-open → 先关单后评论", async () => {
  await withSweepShim(
    {
      TASKS: JSON.stringify([{ number: 7, labels: [{ name: "agent:task" }] }]),
      MERGED7: JSON.stringify([{ number: 44 }]),
      STATE7: "CLOSED",
    },
    async (capture) => {
      await reconcileOpenPrs();
      const calls = await capture();
      assert.ok(calls.includes("issue close 7"));
      assert.ok(calls.includes("issue comment 7"));
      assert.ok(calls.indexOf("issue close 7") < calls.indexOf("issue comment 7"));
    },
  );
});
