import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimFileOf,
  claimIssue,
  claimRefOf,
  dropLocalClaimIfRemoteGone,
  forceReleaseDeadLocalClaim,
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
import { callGit } from "./net.ts";
import { scrubSessionEnv } from "./session-env.ts";
import { daemonShouldKill, evaluateHealth, readStatus } from "./status.ts";

const FAST_PROBE = { attempts: 2, timeoutSeconds: 15 };

const log = (msg: string) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
const out = (msg: string) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

const num = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

let lastSkipSignature = "";

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
      log(`#${issue} body invalid: ${error}`);
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

export async function artifactCleanup(worktrees: string, issue: number): Promise<void> {
  const names = (await readdir(worktrees).catch(() => [] as string[])).filter((name) =>
    new RegExp(
      `^issue-${issue}\\.(claim|pid|log|publishing|publish-pending|status\\.json|events\\.jsonl|implementation\\.json|review\\.json|commit-message\\.json|fix-[0-9]+\\.json|sweep-[0-9]+\\.json)$`,
    ).test(name),
  );
  for (const name of names) await rm(join(worktrees, name), { force: true });
}

async function git(root: string, args: string[]): Promise<string> {
  return callGit(root, args);
}

async function ghIssueClosed(issue: number): Promise<boolean> {
  const state = await ghCall(["issue", "view", String(issue), "--json", "state", "--jq", ".state"]);
  return state.trim() === "CLOSED";
}

// daemon 恢复路径与 worker 进程级失败共用同一个 agent-requeue 预算:
// 不计数的恢复会让坏票在崩溃循环里无限复活,永远到不了 agent:blocked。
export async function requeueWithBudget(issue: number, reason: string): Promise<void> {
  const comments = await ghJson<Array<{ body: string }>>([
    "issue",
    "view",
    String(issue),
    "--json",
    "comments",
    "--jq",
    ".comments",
  ]).catch(() => []);
  const used = comments.filter((c) => c.body.includes("<!-- agent-requeue:")).length;
  const max = num("AGENT_REQUEUE_MAX", 2);
  if (used >= max) {
    await editIssue(issue, { add: ["agent:blocked"], remove: ["agent:running", "agent:queued"] });
    await commentIssue(
      issue,
      `${reason} Requeue budget (${max}) exhausted; needs human attention.`,
    );
    return;
  }
  await editIssue(issue, { add: ["agent:queued"], remove: ["agent:running"] });
  await commentIssue(
    issue,
    `<!-- agent-requeue:${used + 1} --> ${reason} Requeued automatically (${used + 1}/${max}).`,
  );
}

// 认领者死于发布窗口时远端 claim/slot 槽位永不释放;释放活 claim 是安全的——
// 远端残 worker 下次心跳失败会自行中止。
export async function releaseClosedRemoteClaims(
  root: string,
  isClosed: (issue: number) => Promise<boolean>,
): Promise<number[]> {
  const out = await git(root, ["ls-remote", "origin", "agent-claims/issue-*"]).catch(() => "");
  const released: number[] = [];
  for (const line of out.split("\n")) {
    const match = line.trim().match(/agent-claims\/issue-([0-9]+)$/);
    if (!match) continue;
    const issue = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isInteger(issue)) continue;
    if (!(await isClosed(issue).catch(() => false))) continue;
    if (await releaseRemoteClaim(root, issue).catch(() => false)) released.push(issue);
  }
  return released;
}

function spawnWorker(root: string, worktrees: string, issue: number, worktree: string): number {
  const mainTs = fileURLToPath(new URL("./main.ts", import.meta.url));
  const logFd = openSync(join(worktrees, `issue-${issue}.log`), "a");
  const child = spawn(process.execPath, [mainTs, "worker", String(issue), worktree], {
    cwd: root,
    detached: true,
    env: scrubSessionEnv(process.env),
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  if (child.pid === undefined) throw new Error(`failed to spawn worker for #${issue}`);
  return child.pid;
}

export async function dispatchTick(root: string): Promise<void> {
  const worktrees = process.env.AGENT_LOOP_WORKTREES ?? join(root, ".worktrees");
  // DirLock.mkdir 非递归:.worktrees 不存在则锁永远拿不到。
  await mkdir(worktrees, { recursive: true });
  const maxParallel = num("AGENT_LOOP_MAX_PARALLEL", 4);
  const lock = new DirLock(join(worktrees, ".dispatch.lock"));
  if (!(await lock.acquire())) {
    log("another dispatcher owns the dispatch lock");
    return;
  }
  try {
    for (const entry of await readdir(worktrees).catch(() => [] as string[])) {
      const match = entry.match(/^issue-([0-9]+)\.claim$/);
      if (!match) continue;
      const issue = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isInteger(issue)) continue;
      if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) continue;
      // issue 可能已被手工删除。
      const json = await issueView(issue).catch(() => null);
      if (json === null) continue;
      if (!hasLabel(json, "agent:running"))
        await forceReleaseDeadLocalClaim(root, worktrees, issue).catch(() => {});
    }

    for (const { issue, path } of await issueWorktrees(worktrees)) {
      const state = await ghCall([
        "issue",
        "view",
        String(issue),
        "--json",
        "state",
        "--jq",
        ".state",
      ]).catch(() => "");
      if (state.trim() !== "CLOSED") continue;
      if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) {
        log(`defer cleanup #${issue}: worker is still active`);
        continue;
      }
      await releaseClaim(root, worktrees, issue).catch(() => {});
      const branch = (await git(path, ["branch", "--show-current"])).trim();
      await git(root, ["worktree", "remove", "--force", path]);
      if (branch.startsWith("codex/issue-"))
        await git(root, ["branch", "-D", branch]).catch(() => "");
      await artifactCleanup(worktrees, issue);
    }

    for (const issue of await releaseClosedRemoteClaims(root, ghIssueClosed))
      log(`released lingering remote claim of closed #${issue}`);

    for (const ref of await queueIssues()) {
      if (!hasLabel(ref, "agent:running")) continue;
      const issue = ref.number;
      if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) continue;
      const hasLocalClaim = (await readdir(worktrees).catch(() => [] as string[])).includes(
        `issue-${issue}.claim`,
      );
      if (hasLocalClaim) {
        if (!(await forceReleaseDeadLocalClaim(root, worktrees, issue))) {
          log(`defer #${issue}: local claim not releasable yet`);
          continue;
        }
        await rm(join(worktrees, `issue-${issue}.publishing`), { force: true });
        await requeueWithBudget(issue, "Recovered a stale local agent:running claim.");
        continue;
      }
      const remoteSha = await callGit(
        root,
        ["ls-remote", "origin", claimRefOf(issue)],
        FAST_PROBE,
      ).then((out) => out.split(/\s+/)[0] ?? "");
      if (!remoteSha) {
        await requeueWithBudget(
          issue,
          "Recovered an orphaned agent:running label; no live claim exists locally or remotely.",
        );
        continue;
      }
      const staleSha = await remoteClaimStaleSha(root, issue);
      if (staleSha && (await releaseRemoteClaim(root, issue, staleSha))) {
        await requeueWithBudget(issue, "Recovered an expired remote agent claim.");
      } else {
        log(`leave #${issue} running: another clone has a live lease`);
      }
    }

    // 收割让出软干预窗口给 worker 内 watchdog;窗口耗尽才杀(daemonShouldKill)。
    for (const ref of await queueIssues()) {
      if (!hasLabel(ref, "agent:running")) continue;
      const status = await readStatus(worktrees, ref.number);
      if (!status) continue;
      if (!daemonShouldKill(status)) continue;
      const pidText = await readFile(join(worktrees, `issue-${ref.number}.pid`), "utf8").catch(
        () => "",
      );
      const pid = Number.parseInt(pidText.trim(), 10);
      if (!Number.isInteger(pid)) continue;
      log(`killing stuck worker #${ref.number} (pid ${pid}): ${evaluateHealth(status).reason}`);
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
    const skipSignature = frontier.skipped.map((s) => `${s.number}:${s.reason}`).join(" ");
    if (skipSignature !== lastSkipSignature) {
      lastSkipSignature = skipSignature;
      for (const skipped of frontier.skipped) log(`skip #${skipped.number}: ${skipped.reason}`);
    }
    for (const issue of frontier.selected) {
      if (!(await claimIssue(root, worktrees, issue, maxParallel))) {
        // 本地 pid 活着 = 本 clone 有活 worker 在跑;远端租约老化只说明网络风暴
        // 堵了心跳推送,等网络自愈,绝不能"回收"活 claim 造成双重领取。
        if (await pidFileAlive(join(worktrees, `issue-${issue}.pid`))) {
          log(`skip #${issue}: local worker alive, claim recovery deferred`);
          continue;
        }
        // 远端 stale 则强释放远端——之后本地文件同属死掉的旧代,一并摘掉。
        if (!(await dropLocalClaimIfRemoteGone(root, worktrees, issue))) {
          const staleSha = await remoteClaimStaleSha(root, issue);
          if (!(staleSha && (await releaseRemoteClaim(root, issue, staleSha)))) {
            log(`skip #${issue}: already claimed`);
            continue;
          }
          await rm(claimFileOf(worktrees, issue), { force: true });
        }
        if (!(await claimIssue(root, worktrees, issue, maxParallel))) {
          log(`skip #${issue}: already claimed`);
          continue;
        }
        log(`recovered expired claim for #${issue}`);
      }
      // claim 后资格复核:frontier 可能已变(如人工加 serial-only)。
      const recheck = await queue(maxParallel);
      if (!recheck.selected.includes(issue)) {
        await releaseClaim(root, worktrees, issue).catch(() => {});
        log(`skip #${issue}: eligibility changed before claim`);
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
          `^issue-${issue}\\.(publishing|implementation\\.json|review\\.json|commit-message\\.json|status\\.json|events\\.jsonl|fix-[0-9]+\\.json|sweep-[0-9]+\\.json)$`,
        ).test(n),
      ))
        await rm(join(worktrees, name), { force: true });
      const pid = spawnWorker(root, worktrees, issue, worktree);
      await writeFile(join(worktrees, `issue-${issue}.pid`), `${pid}\n`);
      out(`started #${issue} in ${worktree}`);
    }
  } finally {
    await lock.release();
  }
}

// Claude/终端会话退出会回收其子进程树:detached + env 净化是对该契约的硬性要求。
export async function startDaemon(root: string): Promise<number | null> {
  const worktrees = process.env.AGENT_LOOP_WORKTREES ?? join(root, ".worktrees");
  await mkdir(worktrees, { recursive: true });
  if (await pidFileAlive(join(worktrees, ".daemon.lock", "pid"))) return null;
  const mainTs = fileURLToPath(new URL("./main.ts", import.meta.url));
  const logFd = openSync(join(worktrees, "daemon.log"), "a");
  const [bin, args] =
    process.platform === "darwin"
      ? ["caffeinate", ["-dims", process.execPath, mainTs, "daemon"]]
      : [process.execPath, [mainTs, "daemon"]];
  const child = spawn(bin, args, {
    cwd: root,
    detached: true,
    env: scrubSessionEnv(process.env),
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  if (child.pid === undefined) throw new Error("failed to spawn daemon");
  return child.pid;
}

export async function daemon(root: string): Promise<never> {
  const interval = num("AGENT_LOOP_INTERVAL", 30);
  const worktrees = process.env.AGENT_LOOP_WORKTREES ?? join(root, ".worktrees");
  await mkdir(worktrees, { recursive: true });
  const lock = new DirLock(join(worktrees, ".daemon.lock"));
  if (!(await lock.acquire())) {
    log("another daemon owns the daemon lock");
    process.exit(75);
  }
  for (;;) {
    if (!(await lock.verify())) {
      log("daemon lock lost; exiting");
      process.exit(75);
    }
    await dispatchTick(root).catch((error) => {
      log(`dispatch tick failed: ${error}; retrying after ${interval}s`);
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
