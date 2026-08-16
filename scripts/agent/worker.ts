import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { claimFileOf, claimOwned, fenceClaim, heartbeatClaim, releaseClaim } from "./claim.ts";
import { type AgentSession, type ExecutorResult, openAgentSession } from "./executor.ts";
import { normalizeIssue, outsideTouchSet } from "./frontier.ts";
import { commentIssue, editIssue, ghCall, ghJson } from "./gh.ts";
import { DirLock } from "./lock.ts";
import { netCall } from "./net.ts";
import { appendEvent, patchStatus, readStatus } from "./status.ts";

type FailureClass = "process" | "fatal" | "exhausted";

class PhaseTimer {
  private current = "implementation";
  private since = Date.now();
  private readonly durations: Array<{ phase: string; seconds: number }> = [];

  async transition(
    worktrees: string,
    issue: number,
    phase: "implementation" | "review" | "check" | "fix" | "sweep" | "message" | "publish",
  ): Promise<void> {
    const now = Date.now();
    this.durations.push({ phase: this.current, seconds: Math.floor((now - this.since) / 1000) });
    this.current = phase;
    this.since = now;
    await patchStatus(worktrees, issue, { phase }).catch(() => {});
  }

  async finish(worktrees: string, issue: number, phase: "done" | "failed"): Promise<void> {
    const now = Date.now();
    this.durations.push({ phase: this.current, seconds: Math.floor((now - this.since) / 1000) });
    await patchStatus(worktrees, issue, { phase }).catch(() => {});
  }

  report(): string {
    const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`);
    const total = this.durations.reduce((sum, d) => sum + d.seconds, 0);
    const parts = this.durations
      .filter((d) => d.seconds > 0)
      .map((d) => `${d.phase} ${fmt(d.seconds)}`);
    return `⏱ ${parts.join(" → ")} (total ${fmt(total)})`;
  }
}

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
    timer: new PhaseTimer(),
  };
  let startHead = "";
  try {
    startHead = await runPipeline(root, worktree, issue, worktrees, runDir, abort.signal, ctx);
    return 0;
  } catch (error) {
    if (error instanceof WorkerFailure) {
      await handleFailure(issue, worktrees, worktree, startHead, error, ctx.timer);
      return 1;
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    abort.abort();
    if (ctx.watchdog) clearInterval(ctx.watchdog);
    for (const session of ctx.sessions) await session.close().catch(() => {});
    if (ctx.snapshotDir)
      await git(worktree, ["worktree", "remove", "--force", ctx.snapshotDir]).catch(() => {});
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
  timer: PhaseTimer;
  snapshotDir?: string | null;
  watchdog?: NodeJS.Timeout;
}

async function git(worktree: string, args: string[]): Promise<string> {
  return netCall("git", ["-C", worktree, ...args]);
}

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

  // message 文件落在 worktree 内(executor 沙箱只保证能写 cwd),但要对所有 git 检测隐身。
  const messageFile = ".agent-commit-message";
  const excludeFile = resolve(
    worktree,
    (await git(worktree, ["rev-parse", "--git-path", "info/exclude"])).trim(),
  );
  const excludeRules = await readFile(excludeFile, "utf8").catch(() => "");
  if (!excludeRules.split("\n").includes(messageFile))
    await appendFile(excludeFile, `${messageFile}\n`);

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
  const runPhase = async (
    holder: SessionHolder,
    files: { warm: string; cold: string; resume?: string },
    outputName: string,
    keepAlive: boolean,
  ): Promise<void> => {
    const max = num("AGENT_EXECUTOR_ATTEMPTS", 4);
    for (let attempt = 1; ; attempt += 1) {
      let promptFile = files.warm;
      if (!holder.session?.isAlive()) {
        const resumeId = holder.session?.sessionId() ?? null;
        if (holder.session) await holder.session.close().catch(() => {});
        holder.session = openAgentSession({
          worktree,
          worktrees,
          issue,
          env: executorEnv,
          signal: sessionSignal,
          resumeSessionId: resumeId ?? undefined,
        });
        ctx.sessions.push(holder.session);
        promptFile = resumeId ? (files.resume ?? files.warm) : files.cold;
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
      const delay = num("AGENT_EXECUTOR_RETRY_DELAY", 30) * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  };

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
  const continueFile = join(runDir, "continue.md");
  await writeFile(
    continueFile,
    "The previous turn was interrupted by a transport failure. Continue the task from the current worktree state; the issue JSON and instructions are in the earlier conversation.\n",
  );
  await runPhase(
    implHolder,
    { warm: taskFile, cold: taskFile, resume: continueFile },
    "implementation.json",
    true,
  );
  if (!(await historyUnchanged()))
    throw new WorkerFailure(
      "Agent changed git history instead of leaving a controller-owned diff.",
      "fatal",
    );

  const changedFiles = (
    await git(worktree, ["ls-files", "--modified", "--others", "--exclude-standard"])
  )
    .split("\n")
    .filter(Boolean);
  if (changedFiles.length === 0) {
    const explained = await readFile(ctx.artifact("implementation.json"), "utf8")
      .then((text) => {
        const result = (JSON.parse(text) as { result?: unknown }).result;
        return typeof result === "string" && result.trim() ? result.trim() : null;
      })
      .catch(() => null);
    const detail = explained ? `\n\nAgent's blocker report:\n${explained.slice(0, 2000)}` : "";
    throw new WorkerFailure(`Agent produced no repository change.${detail}`, "fatal");
  }

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

  const checkLock = new DirLock(join(worktrees, ".check.lock"));
  const checkLog = join(runDir, "check.log");
  const runCheck = async (dir: string, setPhase = true): Promise<boolean> => {
    if (setPhase) await ctx.timer.transition(worktrees, issue, "check");
    await checkLock.acquireBlocking();
    try {
      const { spawn } = await import("node:child_process");
      const output = await new Promise<string>((resolve) => {
        const child = spawn("make", ["-C", dir, "check"], {
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

  // review.md 授权复审改码:check 必须与 review 隔离文件系统,故跑在快照里。
  const createCheckSnapshot = async (): Promise<string | null> => {
    const snap = join(runDir, "check-snapshot");
    try {
      await git(worktree, ["worktree", "add", "--detach", snap, startHead]);
      const diff = await git(worktree, ["diff", "--binary"]);
      if (diff.trim()) {
        const diffFile = join(runDir, "check-snapshot.diff");
        await writeFile(diffFile, diff);
        await git(snap, ["apply", "--whitespace=nowarn", diffFile]);
      }
      const others = (await git(worktree, ["ls-files", "--others", "--exclude-standard"]))
        .split("\n")
        .filter(Boolean);
      for (const file of others) {
        await mkdir(join(snap, dirname(file)), { recursive: true });
        await copyFile(join(worktree, file), join(snap, file));
      }
      ctx.snapshotDir = snap;
      return snap;
    } catch {
      await git(worktree, ["worktree", "remove", "--force", snap]).catch(() => {});
      return null;
    }
  };

  let prechecked: boolean | null = null;
  if (process.env.AGENT_REVIEW_ENABLED !== "0") {
    await ctx.timer.transition(worktrees, issue, "review");
    const fp0 = await fingerprint();
    const snap = await createCheckSnapshot();
    const snapshotCheck = snap ? runCheck(snap, false) : null;
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
    const reviewChanged = (await fingerprint()) !== fp0;
    if (snapshotCheck) {
      if (!reviewChanged) await ctx.timer.transition(worktrees, issue, "check");
      const result = await snapshotCheck.catch(() => null);
      if (!reviewChanged) prechecked = result;
    }
  }

  const maxFixRounds = num("AGENT_FIX_MAX_ROUNDS", 3);
  let fixRound = 0;
  let sweepRound = 0;
  for (;;) {
    const ok = prechecked ?? (await runCheck(worktree));
    prechecked = null;
    if (ok) {
      if (process.env.AGENT_COMMENT_SWEEP_ENABLED === "0") break;
      sweepRound += 1;
      await ctx.timer.transition(worktrees, issue, "sweep");
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
      await ctx.timer.transition(worktrees, issue, "fix");
      const checkTail = (await readFile(checkLog, "utf8").catch(() => ""))
        .split("\n")
        .slice(-200)
        .join("\n");
      const fixColdFile = join(runDir, "fix.md");
      await writeFile(
        fixColdFile,
        `${await readFile(promptFile, "utf8")}${issueBlock}\n<failed_check_log>\n${checkTail}\n</failed_check_log>\nFull log: ${checkLog}\n`,
      );
      const fixWarmFile = join(runDir, "fix-warm.md");
      await writeFile(
        fixWarmFile,
        `\`make check\` failed. Fix the failures below; keep changes minimal and do not rewrite git history. Full log: ${checkLog}.\n\n<failed_check_log>\n${checkTail}\n</failed_check_log>\n`,
      );
      const fixResumeFile = join(runDir, "fix-resume.md");
      await writeFile(
        fixResumeFile,
        `The previous turn was interrupted by a transport failure. Continue fixing the \`make check\` failures from the current worktree state. Full log: ${checkLog}.\n\n<failed_check_log>\n${checkTail}\n</failed_check_log>\n`,
      );
      await runPhase(
        implHolder,
        { warm: fixWarmFile, cold: fixColdFile, resume: fixResumeFile },
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

  // message 格式说明只进这个收尾轮,不进 task.md:实现阶段的注意力是稀缺资源。
  await ctx.timer.transition(worktrees, issue, "message");
  const messageColdFile = join(runDir, "commit-message.md");
  await writeFile(
    messageColdFile,
    `Inspect the uncommitted worktree diff (\`git diff\` and untracked files) against the attached issue JSON and write the commit message for this work to \`${messageFile}\` in the worktree root. Format — first line \`<type>: <one-line summary>\` with type one of feat, fix, refactor, chore, docs, test, perf (no scope); then a blank line, a 2–3 line summary of what changed, a blank line, and \`Refs #${issue}\`. Match the issue's language. Write only that file: do not commit, do not edit code.${issueBlock}`,
  );
  const messageWarmFile = join(runDir, "commit-message-warm.md");
  await writeFile(
    messageWarmFile,
    `The work is done and all checks pass. Write the commit message for what you implemented to \`${messageFile}\` in the worktree root. Format — first line \`<type>: <one-line summary>\` with type one of feat, fix, refactor, chore, docs, test, perf (no scope); then a blank line, a 2–3 line summary of what changed, a blank line, and \`Refs #${issue}\`. Match the issue's language. Write only that file: do not commit, do not edit code.\n`,
  );
  await runPhase(
    implHolder,
    { warm: messageWarmFile, cold: messageColdFile },
    "commit-message.json",
    false,
  );
  if (!(await historyUnchanged()))
    throw new WorkerFailure(
      "Commit-message agent changed git history instead of leaving a controller-owned diff.",
      "fatal",
    );

  // publish 不再需要模型;先关会话,publish 挂起时不拖子进程。
  if (implHolder.session) {
    await implHolder.session.close().catch(() => {});
    implHolder.session = null;
  }
  if (!(await claimOwned(worktree, ctx.claimFile)))
    throw new WorkerFailure("Agent lost its distributed claim before publication.", "process");

  await ctx.timer.transition(worktrees, issue, "publish");
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

  const outside = await collectOutsideTouchSet();
  const authored = await readFile(join(worktree, messageFile), "utf8")
    .then((text) => text.trim())
    .catch(() => "");
  const fallback = `chore: ${parsed.title}\n\nRefs #${issue}`;
  const messagePath = join(runDir, "commit-message.txt");
  await writeFile(messagePath, authored || fallback);
  await git(worktree, ["config", "user.name", "insuredesk-agent"]);
  await git(worktree, ["config", "user.email", "insuredesk-agent@users.noreply.github.com"]);
  await git(worktree, ["add", "--all"]);
  // repair 复跑改写已推送的 commit,顺带覆盖修复内容。
  await git(worktree, ["commit", ...(repair ? ["--amend"] : []), "-F", messagePath]);
  try {
    // amend 后远端已有旧 commit,必须 lease 覆盖。
    await git(worktree, ["push", "--set-upstream", "--force-with-lease", "origin", "HEAD"]);
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
  const messageNote = authored
    ? ""
    : "\n\nWorker did not produce a commit message; used the fallback `chore: <issue title>`.";
  await ctx.timer.finish(worktrees, issue, "done");
  await commentIssue(
    issue,
    `Agent PR #${pr} published after review and full CI-equivalent checks.${outsideNote}${messageNote}\n\n${ctx.timer.report()}`,
  );
  return startHead;
}

async function handleFailure(
  issue: number,
  worktrees: string,
  worktree: string,
  startHead: string,
  error: WorkerFailure,
  timer: PhaseTimer,
): Promise<void> {
  await timer.finish(worktrees, issue, "failed");
  if (startHead) {
    await git(worktree, ["reset", "--hard", startHead]).catch(() => {});
    await git(worktree, ["clean", "-fd"]).catch(() => {});
  }

  // 人工关单 = 撤回授权:静默死亡,重排队/blocked 的标签与评论只写给 open 单。
  const issueState = await ghCall([
    "issue",
    "view",
    String(issue),
    "--json",
    "state",
    "--jq",
    ".state",
  ]).catch(() => "");
  if (issueState.trim() === "CLOSED") return;

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
    const requeueMax = num("AGENT_REQUEUE_MAX", 2);
    if (requeues < requeueMax) {
      await commentIssue(
        issue,
        `<!-- agent-requeue:${requeues + 1} --> ${error.message} Requeued automatically (${requeues + 1}/${requeueMax}); a further process-level failure will block. ${timer.report()}`,
      );
      await editIssue(issue, { add: ["agent:queued"], remove: ["agent:running"] });
      return;
    }
  }
  await editIssue(issue, { add: ["agent:blocked"], remove: ["agent:running", "agent:queued"] });
  await commentIssue(
    issue,
    `${error.message} See .worktrees/issue-${issue}.log for executor output. ${timer.report()}`,
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
