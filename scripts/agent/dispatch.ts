import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimIssue,
  claimRefOf,
  releaseClaim,
  releaseRemoteClaim,
  remoteClaimStaleSha,
} from "./claim.ts";
import { normalizeIssue, planFrontier } from "./frontier.ts";
import {
  commentIssue,
  editIssue,
  fetchFullIssues,
  ghCall,
  ghJson,
  hasLabel,
  issueView,
  queueIssues,
  syncDependencies,
} from "./gh.ts";
import { DirLock, pidFileAlive } from "./lock.ts";
import { netCall, netCallFast } from "./net.ts";
import { evaluateHealth, readStatus } from "./status.ts";

const num = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const LABELS: Array<[name: string, description: string, color: string]> = [
  ["needs-info", "Waiting for information needed to proceed", "d876e3"],
  ["ready-for-human", "Requires human implementation", "fbca04"],
  ["agent:spec", "Confirmed specification published from a local design session", "8250df"],
  ["agent:task", "Validated executable implementation ticket", "1d76db"],
  ["agent:queued", "Awaiting dependency-free agent dispatch", "fbca04"],
  ["agent:running", "Agent worker owns this issue", "0969da"],
  ["agent:repair", "Existing agent PR needs a CI repair pass", "d93f0b"],
  ["agent:blocked", "Agent needs a new decision or named authority", "b60205"],
  ["agent:automerge", "Agent PR may merge after required checks", "0e8a16"],
  ["serial-only", "Autopilot: run exclusively, no parallel siblings", "d93f0b"],
];

export async function bootstrap(): Promise<void> {
  const existing = await ghCall([
    "label",
    "list",
    "--limit",
    "100",
    "--json",
    "name",
    "--jq",
    ".[].name",
  ]);
  for (const [name, description, color] of LABELS) {
    if (!existing.split("\n").includes(name))
      await ghCall(["label", "create", name, "--description", description, "--color", color]);
  }
}

export function validateBody(body: string): string | null {
  const sectionText = (heading: string) => {
    const after = body.split(new RegExp(`^#{2,3} ${heading}$`, "m"))[1] ?? "";
    return after.split(/^#{2,3} /m)[0] ?? "";
  };
  for (const heading of [
    "Goal",
    "Scope",
    "Declared touch-set",
    "Logical locks",
    "Acceptance criteria",
    "Dependencies",
    "Test plan",
  ])
    if (!new RegExp(`^#{2,3} ${heading}$`, "m").test(body))
      return `missing required heading: ${heading}`;
  if (!/- \[[ xX]\] .+/.test(sectionText("Acceptance criteria")))
    return "acceptance criteria need at least one checkbox";
  for (const heading of ["Dependencies", "Declared touch-set", "Logical locks", "Test plan"])
    if (!/^- /m.test(sectionText(heading))) return `${heading} needs an explicit list or - None`;
  for (const heading of ["Declared touch-set", "Test plan"])
    if (
      !sectionText(heading)
        .split("\n")
        .some((line) => /^- /.test(line) && line.trim().toLowerCase() !== "- none")
    )
      return `${heading} cannot be None`;
  return null;
}

export async function transition(issue: number): Promise<void> {
  const json = await issueView(issue);
  if (json.state !== "OPEN") return;
  if (hasLabel(json, "agent:blocked") || hasLabel(json, "agent:running")) return;
  if (hasLabel(json, "agent:spec")) {
    await editIssue(issue, {
      remove: ["ready-for-agent", "agent:queued", "agent:running", "agent:task", "needs-info"],
    });
    return;
  }
  if (hasLabel(json, "ready-for-agent")) {
    const error = validateBody(json.body ?? "");
    if (error === null) {
      await syncDependencies(issue, json.body ?? "");
      await editIssue(issue, {
        add: ["agent:task", "agent:queued"],
        remove: ["needs-triage", "needs-info"],
      });
    } else {
      process.stderr.write(`#${issue} body invalid: ${error}\n`);
      await editIssue(issue, {
        add: ["needs-info"],
        remove: ["ready-for-agent", "agent:queued", "agent:task"],
      });
    }
  }
}

export async function queue(
  maxParallel: number,
): Promise<{ selected: number[]; skipped: Array<{ number: number; reason: string }> }> {
  const refs = await queueIssues();
  const full = await fetchFullIssues(refs);
  return planFrontier(full.map(normalizeIssue), maxParallel);
}

interface WorktreeEntry {
  issue: number;
  path: string;
}

async function issueWorktrees(worktrees: string): Promise<WorktreeEntry[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(worktrees);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /^issue-[0-9]+$/.test(entry))
    .map((entry) => ({ issue: Number.parseInt(entry.slice(6), 10), path: join(worktrees, entry) }));
}

async function artifactCleanup(worktrees: string, issue: number): Promise<void> {
  const names = (await readdir(worktrees).catch(() => [] as string[])).filter((name) =>
    new RegExp(
      `^issue-${issue}\\.(claim|pid|log|publishing|status\\.json|events\\.jsonl|implementation\\.json|review\\.json|fix-[0-9]+\\.json|sweep-[0-9]+\\.json)$`,
    ).test(name),
  );
  for (const name of names) await rm(join(worktrees, name), { force: true });
}

async function git(root: string, args: string[]): Promise<string> {
  return netCall("git", ["-C", root, ...args]);
}

function spawnWorker(root: string, worktrees: string, issue: number, worktree: string): number {
  const mainTs = fileURLToPath(new URL("./main.ts", import.meta.url));
  const logFd = openSync(join(worktrees, `issue-${issue}.log`), "a");
  const child = spawn(process.execPath, [mainTs, "worker", String(issue), worktree], {
    cwd: root,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  if (child.pid === undefined) throw new Error(`failed to spawn worker for #${issue}`);
  return child.pid;
}

export async function dispatchTick(root: string): Promise<void> {
  const worktrees = process.env.AGENT_LOOP_WORKTREES ?? join(root, ".worktrees");
  const maxParallel = num("AGENT_LOOP_MAX_PARALLEL", 4);
  const lock = new DirLock(join(worktrees, ".dispatch.lock"));
  if (!(await lock.acquire())) {
    process.stderr.write("another dispatcher owns the dispatch lock\n");
    return;
  }
  try {
    // 孤儿 claim 文件：pid 已死且 issue 不在 running,直接还槽。
    for (const entry of await readdir(worktrees).catch(() => [] as string[])) {
      const match = entry.match(/^issue-([0-9]+)\.claim$/);
      if (!match) continue;
      const issue = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isInteger(issue)) continue;
      if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) continue;
      const json = await issueView(issue);
      if (!hasLabel(json, "agent:running"))
        await releaseClaim(root, worktrees, issue).catch(() => {});
    }

    // 已关单 issue 的 worktree 清理。
    for (const { issue, path } of await issueWorktrees(worktrees)) {
      const state = await ghCall([
        "issue",
        "view",
        String(issue),
        "--json",
        "state",
        "--jq",
        ".state",
      ]);
      if (state.trim() !== "CLOSED") continue;
      if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) {
        process.stderr.write(`defer cleanup #${issue}: worker is still active\n`);
        continue;
      }
      await releaseClaim(root, worktrees, issue).catch(() => {});
      const branch = (await git(path, ["branch", "--show-current"])).trim();
      await git(root, ["worktree", "remove", "--force", path]);
      if (branch.startsWith("codex/issue-"))
        await git(root, ["branch", "-D", branch]).catch(() => "");
      await artifactCleanup(worktrees, issue);
    }

    // agent:running 但无活 pid 的恢复：本地 claim 直接还；远端 claim 看 stale。
    for (const ref of await queueIssues()) {
      if (!hasLabel(ref, "agent:running")) continue;
      const issue = ref.number;
      if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) continue;
      const hasLocalClaim = (await readdir(worktrees).catch(() => [] as string[])).includes(
        `issue-${issue}.claim`,
      );
      if (hasLocalClaim) {
        await releaseClaim(root, worktrees, issue);
        await rm(join(worktrees, `issue-${issue}.publishing`), { force: true });
        await editIssue(issue, { add: ["agent:queued"], remove: ["agent:running"] });
        await commentIssue(
          issue,
          "Recovered a stale local agent:running claim; requeued for dispatch.",
        );
        continue;
      }
      const remoteSha = await netCallFast("git", [
        "-C",
        root,
        "ls-remote",
        "origin",
        claimRefOf(issue),
      ]).then((out) => out.split(/\s+/)[0] ?? "");
      if (!remoteSha) {
        // 孤儿 running:本地 pid/claim 与远端 claim 都不存在,无人会来释放。
        await editIssue(issue, { add: ["agent:queued"], remove: ["agent:running"] });
        await commentIssue(
          issue,
          "Recovered an orphaned agent:running label; no live claim exists locally or remotely.",
        );
        continue;
      }
      const staleSha = await remoteClaimStaleSha(root, issue);
      if (staleSha && (await releaseRemoteClaim(root, issue, staleSha))) {
        await editIssue(issue, { add: ["agent:queued"], remove: ["agent:running"] });
        await commentIssue(
          issue,
          "Recovered an expired remote agent claim; requeued for dispatch.",
        );
      } else {
        process.stderr.write(`leave #${issue} running: another clone has a live lease\n`);
      }
    }

    // 卡死 worker 收割:机器判死,kill 后交给孤儿 running 恢复在下一 tick 重排队。
    for (const ref of await queueIssues()) {
      if (!hasLabel(ref, "agent:running")) continue;
      const status = await readStatus(worktrees, ref.number);
      if (!status) continue;
      const health = evaluateHealth(status);
      if (!health.stuck) continue;
      const pidText = await readFile(join(worktrees, `issue-${ref.number}.pid`), "utf8").catch(
        () => "",
      );
      const pid = Number.parseInt(pidText.trim(), 10);
      if (!Number.isInteger(pid)) continue;
      process.stderr.write(`killing stuck worker #${ref.number} (pid ${pid}): ${health.reason}\n`);
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
    }

    await git(root, ["fetch", "origin", "main"]);
    const frontier = await queue(maxParallel);
    for (const skipped of frontier.skipped)
      process.stderr.write(`skip #${skipped.number}: ${skipped.reason}\n`);
    for (const issue of frontier.selected) {
      if (!(await claimIssue(root, worktrees, issue, maxParallel))) {
        const staleSha = await remoteClaimStaleSha(root, issue);
        if (
          staleSha &&
          (await releaseRemoteClaim(root, issue, staleSha)) &&
          (await claimIssue(root, worktrees, issue, maxParallel))
        ) {
          process.stderr.write(`recovered expired claim for #${issue}\n`);
        } else {
          process.stderr.write(`skip #${issue}: already claimed\n`);
          continue;
        }
      }
      // claim 后资格复核:frontier 可能已变(如人工加 serial-only)。
      const recheck = await queue(maxParallel);
      if (!recheck.selected.includes(issue)) {
        await releaseClaim(root, worktrees, issue).catch(() => {});
        process.stderr.write(`skip #${issue}: eligibility changed before claim\n`);
        continue;
      }
      const worktree = join(worktrees, `issue-${issue}`);
      const branch = `codex/issue-${issue}`;
      const exists = await readdir(worktrees).catch(() => [] as string[]);
      if (!exists.includes(`issue-${issue}`)) {
        const branchExists = await git(root, [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${branch}`,
        ])
          .then(() => true)
          .catch(() => false);
        const args = branchExists
          ? ["worktree", "add", worktree, branch]
          : ["worktree", "add", "-b", branch, worktree, "origin/main"];
        try {
          await git(root, args);
        } catch {
          await releaseClaim(root, worktrees, issue).catch(() => {});
          continue;
        }
      }
      try {
        await editIssue(issue, { add: ["agent:running"], remove: ["agent:queued"] });
      } catch {
        await releaseClaim(root, worktrees, issue).catch(() => {});
        continue;
      }
      // 上一轮残留产物会冒充本轮状态。
      for (const name of (await readdir(worktrees).catch(() => [] as string[])).filter((n) =>
        new RegExp(
          `^issue-${issue}\\.(publishing|implementation\\.json|review\\.json|status\\.json|events\\.jsonl|fix-[0-9]+\\.json|sweep-[0-9]+\\.json)$`,
        ).test(n),
      ))
        await rm(join(worktrees, name), { force: true });
      const pid = spawnWorker(root, worktrees, issue, worktree);
      await writeFile(join(worktrees, `issue-${issue}.pid`), `${pid}\n`);
      process.stdout.write(`started #${issue} in ${worktree}\n`);
    }
  } finally {
    await lock.release();
  }
}

export async function daemon(root: string): Promise<never> {
  const interval = num("AGENT_LOOP_INTERVAL", 30);
  const worktrees = process.env.AGENT_LOOP_WORKTREES ?? join(root, ".worktrees");
  const lock = new DirLock(join(worktrees, ".daemon.lock"));
  if (!(await lock.acquire())) {
    process.stderr.write("another daemon owns the daemon lock\n");
    process.exit(75);
  }
  for (;;) {
    // 网络抖动集中在 tick 里回吐;一个失败的 tick 不该杀死常驻 daemon。
    await dispatchTick(root).catch((error) => {
      process.stderr.write(`dispatch tick failed: ${error}; retrying after ${interval}s\n`);
    });
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

export async function reconcileCi(branch: string): Promise<void> {
  const issue = Number.parseInt(branch.replace("codex/issue-", ""), 10);
  if (!Number.isInteger(issue)) return;
  const prs = await ghJson<Array<{ number: number; labels: Array<{ name: string }> }>>([
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number,labels",
  ]);
  const pr = prs.find((candidate) => candidate.labels.some((l) => l.name === "agent:automerge"));
  if (!pr) return;
  const maxAttempts = num("AGENT_REPAIR_MAX_ATTEMPTS", 3);
  const comments = await ghJson<Array<{ body: string }>>([
    "issue",
    "view",
    String(issue),
    "--json",
    "comments",
    "--jq",
    ".comments",
  ]);
  const attempts = comments.filter((c) => c.body.includes("<!-- agent-attempts:")).length;
  if (attempts >= maxAttempts) {
    await editIssue(issue, {
      add: ["agent:blocked"],
      remove: ["agent:running", "agent:queued", "agent:repair"],
    });
    await commentIssue(
      issue,
      `CI repair attempt budget (${maxAttempts}) exhausted; needs human attention.`,
    );
    return;
  }
  await commentIssue(
    issue,
    `<!-- agent-attempts:${attempts + 1} --> CI failed on PR #${pr.number}; requeued for repair (attempt ${attempts + 1}/${maxAttempts}).`,
  );
  // frontier 要求 queued+ready-for-agent;worker 发布时已摘除后者,回队必须补齐。
  await editIssue(issue, {
    add: ["agent:repair", "agent:queued", "ready-for-agent"],
    remove: ["agent:running"],
  });
}
