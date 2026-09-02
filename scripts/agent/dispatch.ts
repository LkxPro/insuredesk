import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
import { baseBranchOf, ensureSpecBranch, finalizeSpecs } from "./spec.ts";
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
      `^issue-${issue}\\.(claim|pid|log|publishing|publish-pending|failed-diff\\.patch|status\\.json|events\\.jsonl|implementation\\.json|review\\.json|commit-message\\.json|fix-[0-9]+\\.json|sweep-[0-9]+\\.json)$`,
    ).test(name),
  );
  for (const name of names) await rm(join(worktrees, name), { force: true });
  await rm(join(worktrees, `issue-${issue}.checkpoint`), { recursive: true, force: true });
}

async function git(
  root: string,
  args: string[],
  policy: { silent?: boolean } = {},
): Promise<string> {
  return callGit(root, args, policy);
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
      const base = baseBranchOf((await issueView(issue)).body);
      if (base !== "main") {
        try {
          await ensureSpecBranch(root, base);
        } catch (error) {
          await releaseClaim(root, worktrees, issue).catch(() => {});
          log(`skip #${issue}: cannot ensure ${base}: ${error}`);
          continue;
        }
      }
      const worktree = join(worktrees, `issue-${issue}`);
      const branch = `codex/issue-${issue}`;
      const exists = await readdir(worktrees).catch(() => [] as string[]);
      if (!exists.includes(`issue-${issue}`)) {
        const branchExists = await git(
          root,
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          { silent: true },
        )
          .then(() => true)
          .catch(() => false);
        const args = branchExists
          ? ["worktree", "add", worktree, branch]
          : ["worktree", "add", "-b", branch, worktree, `origin/${base}`];
        // 分支被其他 worktree 占用(旧 clone 死 worker 残留):占用路径符合 agent 命名
        // 且其姊妹 pid 文件无活进程才清尸体重试。pid 文件缺失有「spawn 成功、pid 未落盘」
        // 的竞态窗口,只给 birthtime 宽限期外的占用判死;有活 pid 是真另有主,放掉 claim。
        const added = await git(root, args).then(
          () => true,
          async (error: unknown) => {
            const text = `${(error as { stderr?: string })?.stderr ?? ""}\n${String(error)}`;
            const occupied = text.match(/already used by worktree at '([^']+)'/)?.[1];
            if (!occupied || basename(occupied) !== `issue-${issue}`) return false;
            const pidFile = join(dirname(occupied), `issue-${issue}.pid`);
            if (await pidFileAlive(pidFile)) return false;
            const pidFileExists = await stat(pidFile).then(
              () => true,
              () => false,
            );
            if (!pidFileExists) {
              // 无 btime 的文件系统 birthtimeMs 退化,用 mtime 兜底。
              const born = await stat(occupied).then(
                (s) => s.birthtimeMs || s.mtimeMs,
                () => 0,
              );
              if (Date.now() - born < num("AGENT_WORKTREE_RECLAIM_GRACE_SECONDS", 120) * 1000)
                return false;
            }
            log(`reclaiming stale worktree ${occupied} for #${issue}`);
            await git(root, ["worktree", "remove", "--force", occupied]).catch(() => "");
            return git(root, args).then(
              () => true,
              () => false,
            );
          },
        );
        if (!added) {
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
    await reconcileOpenPrs();
    await finalizeSpecs(root);
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

// 一次性 GitHub 事件(workflow_run/labeled)会丢:CI cancelled 不触发回队、merge workflow
// 超时后无事件再驱动、贴标签前秒级窗口的失败静默丢失。daemon 每 tick 对账在途 agent PR,
// 把 red(含 cancelled) 无 repair 标的回队、绿而滞留的补 merge、merged-but-open 的补关单。
export async function reconcileOpenPrs(): Promise<void> {
  const prs = await ghJson<
    Array<{
      number: number;
      headRefName: string;
      updatedAt: string;
      labels: Array<{ name: string }>;
      statusCheckRollup: Array<{
        name?: string;
        context?: string;
        status?: string;
        conclusion?: string | null;
        state?: string;
      }>;
    }>
  >([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,headRefName,labels,updatedAt,statusCheckRollup",
  ]);
  const stuckMinutes = num("AGENT_MERGE_STUCK_MINUTES", 35);
  for (const pr of prs) {
    const match = pr.headRefName.match(/^codex\/issue-([0-9]+)$/);
    if (!match) continue;
    const issue = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isInteger(issue)) continue;
    // merge-and-close 自身是 PR 上的 check:计入检查等于等自己。
    const checks = pr.statusCheckRollup.filter((c) => (c.name ?? c.context) !== "merge-and-close");
    const stateOf = (c: (typeof checks)[number]): "green" | "red" | "pending" => {
      if (c.status && c.status.toUpperCase() !== "COMPLETED") return "pending";
      const conclusion = c.conclusion?.toUpperCase();
      if (conclusion)
        return ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(conclusion) ? "green" : "red";
      const state = c.state?.toUpperCase();
      if (state === "SUCCESS") return "green";
      if (state === "PENDING") return "pending";
      return "red";
    };
    const states = checks.map(stateOf);
    const issueJson = await issueView(issue).catch(() => null);
    if (issueJson?.state !== "OPEN") continue;
    // blocked 归人:预算耗尽分支每次评论会变每 tick 刷屏;sweep 一律不动它。
    if (hasLabel(issueJson, "agent:running") || hasLabel(issueJson, "agent:blocked")) continue;
    // 贴标签前的 CI 失败已由 agent:running 跳过与断点续跑覆盖;此后仍无
    // agent:automerge 的 PR 不归本 loop 管,红色也不动它(防误回队人工/异常 PR)。
    const automerge = pr.labels.some((l) => l.name === "agent:automerge");
    if (states.includes("red")) {
      if (!automerge || hasLabel(issueJson, "agent:repair")) continue;
      log(
        `reconcile: PR #${pr.number} checks red/cancelled without repair label; requeue #${issue}`,
      );
      await requeueForRepair(issue, pr.number);
      continue;
    }
    if (states.includes("pending") || checks.length === 0) continue;
    if (!automerge) continue;
    const ageMs = Date.now() - Date.parse(pr.updatedAt);
    if (ageMs < stuckMinutes * 60_000) continue;
    // 全绿但滞留超过 merge workflow 的 30min 预算:workflow 已死,daemon 补 merge。
    // 不带 --delete-branch:本地分支被 worker worktree 占用时 gh 会因删本地分支
    // 失败而整体报错(服务端 merge 其实已成);远端分支由仓库 auto-delete 收拾,
    // 本地分支与 worktree 归 dispatch 的关闭回收管。
    try {
      await ghCall(["pr", "merge", String(pr.number), "--squash"]);
      log(`reconcile: merged stuck green PR #${pr.number} for #${issue}`);
    } catch (error) {
      // 与 merge workflow 竞合:败者报错时 PR 可能已被对方合并,先确认仍 OPEN 再叫人。
      const stillOpen = await ghJson<{ state: string }>([
        "pr",
        "view",
        String(pr.number),
        "--json",
        "state",
      ])
        .then((view) => view.state === "OPEN")
        .catch(() => true);
      if (!stillOpen) continue;
      const comments = await ghJson<Array<{ body: string }>>([
        "pr",
        "view",
        String(pr.number),
        "--json",
        "comments",
        "--jq",
        ".comments",
      ]).catch(() => []);
      if (!comments.some((c) => c.body.includes("<!-- agent-merge-stuck -->"))) {
        await ghCall([
          "pr",
          "comment",
          String(pr.number),
          "--body",
          `<!-- agent-merge-stuck --> Checks are green but both the merge workflow and the daemon sweep failed to merge: ${String(error).slice(0, 300)}. Needs human attention.`,
        ]).catch(() => "");
      }
      log(`reconcile: merge attempt failed for PR #${pr.number}: ${String(error)}`);
    }
  }
  // merged-but-open(agent-merge 的 gh issue close 静默失败、非默认 base 时 Closes
  // 关键字不生效、merge workflow 整体未跑)由这里兜底关单。
  const openTasks = await ghJson<Array<{ number: number; labels: Array<{ name: string }> }>>([
    "issue",
    "list",
    "--label",
    "agent:task",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,labels",
  ]);
  for (const task of openTasks) {
    const names = task.labels.map((l) => l.name);
    if (names.some((n) => ["agent:running", "agent:queued", "agent:repair"].includes(n))) continue;
    const merged = await ghJson<Array<{ number: number }>>([
      "pr",
      "list",
      "--head",
      `codex/issue-${task.number}`,
      "--state",
      "merged",
      "--json",
      "number",
    ]).catch(() => []);
    const pr = merged[0]?.number;
    if (!pr) continue;
    // 先关单后评论:评论成功而关单失败会每 tick 重复刷屏。
    await ghCall(["issue", "close", String(task.number)]).catch(() => "");
    const closedNow = await ghIssueClosed(task.number).catch(() => false);
    if (!closedNow) continue;
    await commentIssue(task.number, `PR #${pr} merged; closing (daemon sweep).`);
    log(`reconcile: closed merged-but-open #${task.number} (PR #${pr})`);
  }
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
  // 心跳文件:log 静默期间区分 idle 与挂死的唯一外部信号。
  const heartbeatFile = join(worktrees, "daemon.heartbeat");
  let tick = 0;
  for (;;) {
    if (!(await lock.verify())) {
      log("daemon lock lost; exiting");
      process.exit(75);
    }
    const failure = await dispatchTick(root)
      .then(() => "")
      .catch((error) => String(error));
    tick += 1;
    await writeFile(
      heartbeatFile,
      `${JSON.stringify({ ts: Date.now(), tick, ok: failure === "", ...(failure ? { error: failure.slice(0, 300) } : {}) })}\n`,
    ).catch(() => {});
    if (failure) log(`dispatch tick failed: ${failure}; retrying after ${interval}s`);
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

// CI 修复回队的唯一入口:workflow 事件驱动(agent-pr-health)与 daemon 周期对账共用,
// 同一个 agent-attempts 预算,超 budget 转 blocked。repair 标是双入口的乐观锁:
// 先查后落,撞车时后手在查标阶段就退出,预算不被一次失败烧两次。
async function requeueForRepair(issue: number, prNumber: number): Promise<void> {
  const current = await issueView(issue).catch(() => null);
  if (current && hasLabel(current, "agent:repair")) return;
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
  // frontier 要求 queued+ready-for-agent;worker 发布时已摘除后者,回队必须补齐。
  await editIssue(issue, {
    add: ["agent:repair", "agent:queued", "ready-for-agent"],
    remove: ["agent:running"],
  });
  await commentIssue(
    issue,
    `<!-- agent-attempts:${attempts + 1} --> CI failed on PR #${prNumber}; requeued for repair (attempt ${attempts + 1}/${maxAttempts}).`,
  );
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
  await requeueForRepair(issue, pr.number);
}
