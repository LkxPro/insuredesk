import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimFileOf, claimOwned, fenceClaim, heartbeatClaim, releaseClaim } from "./claim.ts";
import { type AgentSession, type ExecutorResult, openAgentSession } from "./executor.ts";
import { normalizeIssue, outsideTouchSet } from "./frontier.ts";
import { commentIssue, editIssue, ghCall, ghJson } from "./gh.ts";
import { DirLock } from "./lock.ts";
import { netCall } from "./net.ts";
import { appendEvent, patchStatus, readStatus } from "./status.ts";

type FailureClass = "process" | "fatal" | "exhausted";

class WorkerFailure extends Error {
  readonly failureClass: FailureClass;

  constructor(message: string, failureClass: FailureClass) {
    super(message);
    this.failureClass = failureClass;
  }
}

const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

// subtype=success + is_error 是 transport/API 层失败的矛盾组合,按 transient 重试。
const transient = (result: ExecutorResult) =>
  result.subtype === "" ||
  result.subtype === "error_during_execution" ||
  result.subtype === "success";

export async function runWorker(root: string, worktree: string, issue: number): Promise<number> {
  const worktrees = dirname(worktree);
  const claimFile = claimFileOf(worktrees, issue);
  const publishMarker = join(worktrees, `issue-${issue}.publishing`);
  const artifact = (name: string) => join(worktrees, `issue-${issue}.${name}`);

  const abort = new AbortController();
  let misses = 0;
  // claim 心跳：连续失败才认定丢失，单次网络抖动不杀健康 worker。
  const heartbeat = setInterval(async () => {
    try {
      await readFile(publishMarker, "utf8");
      return;
    } catch {}
    try {
      if (await heartbeatClaim(root, worktrees, issue)) {
        misses = 0;
        return;
      }
    } catch {}
    misses += 1;
    if (misses >= num("AGENT_CLAIM_HEARTBEAT_MAX_MISSES", 3)) {
      clearInterval(heartbeat);
      abort.abort();
    }
  }, num("AGENT_CLAIM_HEARTBEAT_INTERVAL", 60) * 1000);
  heartbeat.unref();

  const runDir = await mkdtemp(join(tmpdir(), `agent-worker-${issue}-`));
  const ctx: PipelineContext = {
    claimFile,
    publishMarker,
    artifact,
    sessions: [],
    activeSession: { current: null },
  };
  let startHead = "";
  try {
    startHead = await runPipeline(root, worktree, issue, worktrees, runDir, abort.signal, ctx);
    return 0;
  } catch (error) {
    if (error instanceof WorkerFailure) {
      await handleFailure(issue, worktrees, worktree, startHead, error);
      return 1;
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    abort.abort();
    if (ctx.watchdog) clearInterval(ctx.watchdog);
    for (const session of ctx.sessions) await session.close().catch(() => {});
    await releaseClaim(root, worktrees, issue).catch(() => {});
    await rm(join(worktrees, `issue-${issue}.pid`), { force: true });
    await rm(publishMarker, { force: true });
    await rm(runDir, { recursive: true, force: true });
  }
}

interface PipelineContext {
  claimFile: string;
  publishMarker: string;
  artifact: (name: string) => string;
  sessions: AgentSession[];
  activeSession: { current: AgentSession | null };
  watchdog?: NodeJS.Timeout;
}

async function git(worktree: string, args: string[]): Promise<string> {
  return netCall("git", ["-C", worktree, ...args]);
}

// 返回起跑头,供失败路径复位。
async function runPipeline(
  root: string,
  worktree: string,
  issue: number,
  worktrees: string,
  runDir: string,
  signal: AbortSignal,
  ctx: PipelineContext,
): Promise<string> {
  const issueJson = await ghCall([
    "issue",
    "view",
    String(issue),
    "--json",
    "number,title,body,comments,labels",
  ]);
  const parsed = JSON.parse(issueJson) as {
    title: string;
    body: string;
    labels: Array<{ name: string }>;
    comments: Array<{ body: string }>;
  };
  const labelNames = parsed.labels.map((l) => l.name);
  const repair = labelNames.includes("agent:repair");
  const promptFile = join(root, ".github", "agent-prompts", repair ? "repair.md" : "task.md");

  let repairLog = "";
  if (repair) {
    const branch = (await git(worktree, ["branch", "--show-current"])).trim();
    const failedRun = await ghJson<Array<{ databaseId: number }>>([
      "run",
      "list",
      "--branch",
      branch,
      "--status",
      "failure",
      "--limit",
      "1",
    ])
      .then((runs) => runs[0]?.databaseId)
      .catch(() => undefined);
    if (failedRun) {
      repairLog = await ghCall(["run", "view", String(failedRun), "--log-failed"]).catch(() => "");
    }
  }

  const taskFile = join(runDir, "task.md");
  const issueBlock = `\n\n<issue_json>\n${JSON.stringify(parsed)}\n</issue_json>\n`;
  const repairBlock = repairLog ? `\n<failed_ci_log>\n${repairLog}\n</failed_ci_log>\n` : "";
  await writeFile(taskFile, `${await readFile(promptFile, "utf8")}${issueBlock}${repairBlock}`);

  const startHead = (
    (await git(worktree, ["rev-parse", "--verify", "@{upstream}^{commit}"]).catch(() => "")) ||
    (await git(worktree, ["rev-parse", "--verify", "origin/main^{commit}"]).catch(() => "")) ||
    (await git(worktree, ["rev-parse", "--verify", "HEAD^{commit}"]))
  ).trim();
  await git(worktree, ["reset", "--hard", startHead]);
  await git(worktree, ["clean", "-fd"]);

  const historyUnchanged = async () =>
    (await git(worktree, ["rev-parse", "HEAD"])).trim() === startHead;

  const frontierIssue = normalizeIssue(JSON.parse(issueJson));
  // touch-set 只是并行调度的冲突参考,越界不判失败;发布时列出供审计。
  const collectOutsideTouchSet = async (): Promise<string[]> => {
    const changed = (
      await git(worktree, ["ls-files", "--modified", "--others", "--exclude-standard"])
    )
      .split("\n")
      .filter(Boolean);
    return outsideTouchSet(frontierIssue.touchSet, changed);
  };

  const executorEnv: NodeJS.ProcessEnv = {
    // 发布隔离：模型物理上无推送/调 API 凭据。
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "remote.origin.url",
    GIT_CONFIG_VALUE_0: "disabled://agent-model-has-no-publish-authority",
    GH_CONFIG_DIR: join(runDir, "gh"),
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    SSH_AUTH_SOCK: "",
  };

  // claim 丢失 abort 与 stall abort 都经 sessionSignal 杀会话;只有 stall 在重试层短路成失败。
  const stallAbort = new AbortController();
  const sessionSignal = AbortSignal.any([signal, stallAbort.signal]);

  interface SessionHolder {
    session: AgentSession | null;
  }

  // error_during_execution 等 provider/网络 transient 同 run 内退避重试;
  // error_max_turns 等行为类失败重试无益。
  // 会话活着用 warm 短 prompt(上下文还在);死了重开并用 cold 完整 prompt 冷启动。
  const runPhase = async (
    holder: SessionHolder,
    files: { warm: string; cold: string },
    outputName: string,
    keepAlive: boolean,
  ): Promise<void> => {
    const max = num("AGENT_EXECUTOR_ATTEMPTS", 2);
    for (let attempt = 1; ; attempt += 1) {
      let promptFile = files.warm;
      if (!holder.session?.isAlive()) {
        if (holder.session) await holder.session.close().catch(() => {});
        holder.session = openAgentSession({
          worktree,
          worktrees,
          issue,
          env: executorEnv,
          signal: sessionSignal,
        });
        ctx.sessions.push(holder.session);
        promptFile = files.cold;
      }
      ctx.activeSession.current = holder.session;
      const result = await holder.session.run(promptFile, ctx.artifact(outputName));
      ctx.activeSession.current = null;
      if (result.ok) {
        if (!keepAlive) {
          await holder.session.close().catch(() => {});
          holder.session = null;
        }
        return;
      }
      if (stallAbort.signal.aborted)
        throw new WorkerFailure(
          "Worker stalled and did not recover within the nudge grace period.",
          "process",
        );
      if (attempt >= max || !transient(result)) {
        await holder.session?.close().catch(() => {});
        holder.session = null;
        throw new WorkerFailure(
          `executor failed: ${outputName} (${result.subtype || "unknown"})`,
          "process",
        );
      }
      process.stderr.write(`executor attempt ${attempt} failed (transient); retrying\n`);
      await new Promise((resolve) =>
        setTimeout(resolve, num("AGENT_EXECUTOR_RETRY_DELAY", 30) * 1000),
      );
    }
  };

  // stall 软干预:claude 相无事件超阈值就往在途轮注 nudge;宽限内未恢复才杀。
  // nudge 只在 CLI 下一 tool round 生效,救得了慢/绕圈,救不了进程楔死。
  const nudgeAfter = num("AGENT_NUDGE_AFTER_SECONDS", 600);
  const nudgeGrace = num("AGENT_NUDGE_GRACE_SECONDS", 600);
  const nudgeMax = num("AGENT_NUDGE_MAX_PER_RUN", 2);
  const nudgeTemplate = await readFile(
    join(root, ".github", "agent-prompts", "stuck-nudge.md"),
    "utf8",
  );
  let nudgesUsed = 0;
  let nudgePendingSince = 0;
  const watchdog = setInterval(() => {
    void (async () => {
      const status = await readStatus(worktrees, issue);
      if (!status) return;
      if (["check", "publish", "done", "failed"].includes(status.phase)) return;
      const now = Date.now();
      if (nudgePendingSince > 0) {
        if ((status.lastEvent?.ts ?? 0) > nudgePendingSince) {
          nudgePendingSince = 0;
          await patchStatus(worktrees, issue, { nudgedAt: null }).catch(() => {});
          return;
        }
        if (now - nudgePendingSince > nudgeGrace * 1000) stallAbort.abort();
        return;
      }
      const lastTs = status.lastEvent?.ts ?? status.phaseSince;
      const silentSeconds = Math.floor((now - lastTs) / 1000);
      if (silentSeconds <= nudgeAfter) return;
      const session = ctx.activeSession.current;
      if (!session?.inFlight() || !session.isAlive()) return;
      if (nudgesUsed >= nudgeMax) {
        stallAbort.abort();
        return;
      }
      nudgesUsed += 1;
      nudgePendingSince = now;
      const reason = `${status.phase}: no executor event for ${Math.floor(silentSeconds / 60)}min`;
      session.sendNudge(nudgeTemplate.replaceAll("{reason}", reason));
      await appendEvent(worktrees, issue, {
        type: "agent",
        subtype: "nudge",
        reason,
        count: nudgesUsed,
      }).catch(() => {});
      await patchStatus(worktrees, issue, { nudgedAt: now }).catch(() => {});
    })().catch(() => {});
  }, num("AGENT_NUDGE_WATCHDOG_SECONDS", 15) * 1000);
  watchdog.unref();
  ctx.watchdog = watchdog;

  await patchStatus(worktrees, issue, { phase: "implementation" });
  const implHolder: SessionHolder = { session: null };
  await runPhase(implHolder, { warm: taskFile, cold: taskFile }, "implementation.json", true);
  if (!(await historyUnchanged()))
    throw new WorkerFailure(
      "Agent changed git history instead of leaving a controller-owned diff.",
      "fatal",
    );

  if (process.env.AGENT_REVIEW_ENABLED !== "0") {
    await patchStatus(worktrees, issue, { phase: "review" });
    const reviewFile = join(runDir, "review.md");
    await writeFile(
      reviewFile,
      `${await readFile(join(root, ".github", "agent-prompts", "review.md"), "utf8")}${issueBlock}`,
    );
    // review 必须独立于 implementation 会话,保持新鲜眼睛。
    await runPhase({ session: null }, { warm: reviewFile, cold: reviewFile }, "review.json", false);
    if (!(await historyUnchanged()))
      throw new WorkerFailure(
        "Review agent changed git history instead of leaving a controller-owned diff.",
        "fatal",
      );
  }

  const changedFiles = (
    await git(worktree, ["ls-files", "--modified", "--others", "--exclude-standard"])
  )
    .split("\n")
    .filter(Boolean);
  if (changedFiles.length === 0) {
    // 模型按规矩 exit 并解释的 blocker 写在 implementation result 里;
    // 不进评论的话人只能翻日志,blocked 就失去信息量。
    const explained = await readFile(ctx.artifact("implementation.json"), "utf8")
      .then((text) => {
        const result = (JSON.parse(text) as { result?: unknown }).result;
        return typeof result === "string" && result.trim() ? result.trim() : null;
      })
      .catch(() => null);
    const detail = explained ? `\n\nAgent's blocker report:\n${explained.slice(0, 2000)}` : "";
    throw new WorkerFailure(`Agent produced no repository change.${detail}`, "fatal");
  }

  const checkLock = new DirLock(join(worktrees, ".check.lock"));
  const checkLog = join(runDir, "check.log");
  const runCheck = async (): Promise<boolean> => {
    await patchStatus(worktrees, issue, { phase: "check" });
    await checkLock.acquireBlocking();
    try {
      const { spawn } = await import("node:child_process");
      const output = await new Promise<string>((resolve) => {
        const child = spawn("make", ["-C", worktree, "check"], {
          detached: true,
          env: process.env,
        });
        let text = "";
        child.stdout?.on("data", (c: string) => (text += c));
        child.stderr?.on("data", (c: string) => (text += c));
        const watchdog = setTimeout(() => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, num("AGENT_CHECK_TIMEOUT_SECONDS", 1800) * 1000);
        watchdog.unref();
        child.on("close", (code) => {
          clearTimeout(watchdog);
          resolve(`${text}\n__exit=${code ?? 1}`);
        });
      });
      await writeFile(checkLog, output);
      return output.endsWith("__exit=0");
    } finally {
      await checkLock.release();
    }
  };

  const fingerprint = async (): Promise<string> => {
    const diff = await git(worktree, ["diff", "--binary"]);
    const others = (await git(worktree, ["ls-files", "--others", "--exclude-standard"]))
      .split("\n")
      .filter(Boolean);
    const hashes: string[] = [];
    for (const file of others) {
      hashes.push(`${file} ${await git(worktree, ["hash-object", "--", file]).catch(() => "")}`);
    }
    const { createHash } = await import("node:crypto");
    return createHash("sha1").update(diff).update(hashes.join("\n")).digest("hex");
  };

  const maxFixRounds = num("AGENT_FIX_MAX_ROUNDS", 3);
  let fixRound = 0;
  let sweepRound = 0;
  for (;;) {
    if (await runCheck()) {
      if (process.env.AGENT_COMMENT_SWEEP_ENABLED === "0") break;
      sweepRound += 1;
      await patchStatus(worktrees, issue, { phase: "sweep" });
      const sweepFile = join(runDir, "sweep.md");
      await writeFile(
        sweepFile,
        `${await readFile(join(root, ".github", "agent-prompts", "comment-sweep.md"), "utf8")}${issueBlock}`,
      );
      const before = await fingerprint();
      // sweep 同 review:独立会话,避免实现会话偏护自己写的注释。
      await runPhase(
        { session: null },
        { warm: sweepFile, cold: sweepFile },
        `sweep-${sweepRound}.json`,
        false,
      );
      if (!(await historyUnchanged()))
        throw new WorkerFailure(
          "Comment sweep changed git history instead of leaving a controller-owned diff.",
          "fatal",
        );
      // 清扫可能误删指令注释,有改动就必须重跑 check。
      if (before === (await fingerprint())) break;
    } else {
      fixRound += 1;
      if (fixRound > maxFixRounds)
        throw new WorkerFailure(
          `Deterministic make check failed after ${maxFixRounds} fix rounds.`,
          "exhausted",
        );
      await patchStatus(worktrees, issue, { phase: "fix" });
      const checkTail = (await readFile(checkLog, "utf8").catch(() => ""))
        .split("\n")
        .slice(-200)
        .join("\n");
      const fixColdFile = join(runDir, "fix.md");
      await writeFile(
        fixColdFile,
        `${await readFile(promptFile, "utf8")}${issueBlock}\n<failed_check_log>\n${checkTail}\n</failed_check_log>\nFull log: ${checkLog}\n`,
      );
      // warm 路径会话里已有 task/issue 上下文,只带日志与约束提醒。
      const fixWarmFile = join(runDir, "fix-warm.md");
      await writeFile(
        fixWarmFile,
        `\`make check\` failed. Fix the failures below; keep changes minimal and do not rewrite git history. Full log: ${checkLog}.\n\n<failed_check_log>\n${checkTail}\n</failed_check_log>\n`,
      );
      await runPhase(
        implHolder,
        { warm: fixWarmFile, cold: fixColdFile },
        `fix-${fixRound}.json`,
        true,
      );
      if (!(await historyUnchanged()))
        throw new WorkerFailure(
          "Fix agent changed git history instead of leaving a controller-owned diff.",
          "fatal",
        );
    }
  }

  // publish 不再需要模型;先关会话,publish 挂起时不拖子进程。
  if (implHolder.session) {
    await implHolder.session.close().catch(() => {});
    implHolder.session = null;
  }
  if (!(await claimOwned(worktree, ctx.claimFile)))
    throw new WorkerFailure("Agent lost its distributed claim before publication.", "process");

  await patchStatus(worktrees, issue, { phase: "publish" });
  // fence 与 heartbeat 并发:lease 被拒或传输抖动都按可重试处理。
  const fenceMax = num("AGENT_FENCE_ATTEMPTS", 3);
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fenceClaim(root, worktrees, issue, ctx.publishMarker);
      break;
    } catch {
      if (attempt >= fenceMax)
        throw new WorkerFailure(
          "Agent could not fence its distributed claim for publication.",
          "process",
        );
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  // commit 前收集,commit 后 ls-files 干净就看不到了。
  const outside = await collectOutsideTouchSet();
  await git(worktree, ["config", "user.name", "insuredesk-agent"]);
  await git(worktree, ["config", "user.email", "insuredesk-agent@users.noreply.github.com"]);
  await git(worktree, ["add", "--all"]);
  await git(worktree, ["commit", "-m", `agent: resolve issue #${issue}`]);
  try {
    await git(worktree, ["push", "--set-upstream", "origin", "HEAD"]);
  } catch {
    throw new WorkerFailure("Agent could not push its publication branch.", "process");
  }

  const branch = (await git(worktree, ["branch", "--show-current"])).trim();
  const existing = await ghJson<Array<{ number: number }>>([
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number",
  ]);
  let pr = existing[0]?.number;
  if (!pr) {
    const bodyFile = join(runDir, "pr-body.md");
    await writeFile(
      bodyFile,
      `Closes #${issue}\n\nAutomated implementation; review and \`make check\` passed before publication.\n`,
    );
    const url = await ghCall([
      "pr",
      "create",
      "--head",
      branch,
      "--base",
      "main",
      "--title",
      `${parsed.title} (#${issue})`,
      "--body-file",
      bodyFile,
    ]);
    pr = Number.parseInt(url.trim().split("/").pop() ?? "", 10);
    if (!Number.isInteger(pr))
      throw new WorkerFailure("Agent could not open its pull request.", "process");
  }
  await ghCall(["pr", "edit", String(pr), "--add-label", "agent:automerge"]);
  // ready-for-agent 必须一并摘除:unlabeled 事件触发 transition,留着会被重新入队。
  await editIssue(issue, { remove: ["agent:running", "agent:repair", "ready-for-agent"] });
  const outsideNote =
    outside.length > 0
      ? `\n\nChanged files outside the declared touch-set (allowed; touch-set is the parallel-scheduling contract, not a hard boundary): ${outside.map((f) => `\`${f}\``).join(", ")}`
      : "";
  await commentIssue(
    issue,
    `Agent PR #${pr} published after review and full CI-equivalent checks.${outsideNote}`,
  );
  await patchStatus(worktrees, issue, { phase: "done" });
  return startHead;
}

async function handleFailure(
  issue: number,
  worktrees: string,
  worktree: string,
  startHead: string,
  error: WorkerFailure,
): Promise<void> {
  await patchStatus(worktrees, issue, { phase: "failed" }).catch(() => {});
  if (startHead) {
    await git(worktree, ["reset", "--hard", startHead]).catch(() => {});
    await git(worktree, ["clean", "-fd"]).catch(() => {});
  }

  // 进程级失败多为 transient,自动重排队一次;再失败或行为类失败转 blocked。
  if (error.failureClass === "process") {
    const comments = await ghJson<Array<{ body: string }>>([
      "issue",
      "view",
      String(issue),
      "--json",
      "comments",
      "--jq",
      ".comments",
    ]).catch(() => []);
    const requeues = comments.filter((c) => c.body.includes("<!-- agent-requeue:")).length;
    if (requeues < 1) {
      await commentIssue(
        issue,
        `<!-- agent-requeue:1 --> ${error.message} Requeued automatically; a second process-level failure will block.`,
      );
      await editIssue(issue, { add: ["agent:queued"], remove: ["agent:running"] });
      return;
    }
  }
  await editIssue(issue, { add: ["agent:blocked"], remove: ["agent:running", "agent:queued"] });
  await commentIssue(
    issue,
    `${error.message} See .worktrees/issue-${issue}.log for executor output.`,
  );
  // 桌面通知只在真实跑单时有意义;测试用 AGENT_BLOCK_NOTIFY=0 关掉。
  if (process.env.AGENT_BLOCK_NOTIFY === "0") return;
  await netCall(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      "display notification (item 1 of argv) with title (item 2 of argv)",
      "-e",
      "end run",
      "--",
      error.message,
      `InsureDesk agent blocked: issue #${issue}`,
    ],
    { attempts: 1 },
  ).catch(() => {});
}
