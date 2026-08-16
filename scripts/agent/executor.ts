import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { scrubSessionEnv } from "./session-env.ts";
import { appendEvent, patchStatus } from "./status.ts";

export interface SessionOptions {
  worktree: string;
  worktrees: string;
  issue: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  resumeSessionId?: string;
}

export interface ExecutorResult {
  ok: boolean;
  subtype: string;
  isError: boolean;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  num_turns?: number;
  stop_reason?: string;
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
      input?: Record<string, unknown>;
    }>;
  };
  [key: string]: unknown;
}

// 状态行给人看的操作对象:Bash 取首行命令,文件类取路径,搜索类取 pattern。
function toolTarget(name: string, input: Record<string, unknown> | undefined): string {
  const pick = (key: string) => {
    const value = input?.[key];
    return typeof value === "string" ? value : "";
  };
  const raw =
    name === "Bash"
      ? pick("command")
      : pick("file_path") || pick("path") || pick("pattern") || pick("command");
  return (raw.split("\n")[0] ?? "").slice(0, 80);
}

function summarize(event: StreamEvent): { kind: string; summary: string } | null {
  if (event.type === "assistant") {
    const content = event.message?.content ?? [];
    const tools = content.filter((c) => c.type === "tool_use");
    if (tools.length) {
      return {
        kind: tools.map((c) => c.name ?? "tool").join(","),
        summary: tools
          .map((c) => {
            const target = toolTarget(c.name ?? "", c.input);
            return target ? `${c.name ?? "tool"}(${target})` : (c.name ?? "tool");
          })
          .join(","),
      };
    }
    if (content.some((c) => c.type === "text")) return { kind: "text", summary: "" };
    return null;
  }
  if (event.type === "result") return { kind: "result", summary: event.subtype ?? "" };
  return null;
}

export interface AgentSession {
  // 发送一轮 prompt 并等待该轮的 result 事件。调用方串行,禁止并发 run。
  run(promptFile: string, outputFile: string): Promise<ExecutorResult>;
  // 软干预:向在途轮注入 user message(CLI 在下一 tool round 吸收),不等结果。
  sendNudge(text: string): void;
  inFlight(): boolean;
  isAlive(): boolean;
  // init 事件落定的 session_id,供崩溃后 --resume 续跑;未 init 即死返回 null。
  sessionId(): string | null;
  close(): Promise<void>;
}

const userMessage = (text: string) =>
  `${JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  })}\n`;

// claude -p --input-format stream-json --output-format stream-json --verbose:
// 每个 stdin user message 触发一轮,result 事件定界;进程跨轮存活,stdin 关闭后退出。
// 原始事件全量落 events.jsonl,聚合心跳写 status.json(节流 1/s,写盘是 tmp+rename)。
export function openAgentSession(options: SessionOptions): AgentSession {
  const claudeBin = process.env.AGENT_CLAUDE_BIN ?? "claude";
  const permissionMode = process.env.AGENT_CLAUDE_PERMISSION_MODE ?? "bypassPermissions";
  // headless -p 下权限弹窗等于自动拒绝,必须显式 bypass。
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (process.env.AGENT_MAX_TURNS) args.push("--max-turns", process.env.AGENT_MAX_TURNS);
  if (permissionMode === "bypassPermissions") args.push("--dangerously-skip-permissions");
  else args.push("--permission-mode", permissionMode);
  if (process.env.AGENT_MODEL) args.push("--model", process.env.AGENT_MODEL);
  if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);

  const child = spawn(claudeBin, args, {
    cwd: options.worktree,
    detached: true,
    env: { ...scrubSessionEnv(process.env), ...options.env, AGENT_WORKTREE: options.worktree },
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (!child.stdin || !child.stdout) throw new Error("child stdio not piped");
  const stdin = child.stdin;
  // 子进程先于写入死亡时管道写触发异步 EPIPE;挂监听防 unhandled 崩溃,
  // 失败合成统一走 close → failPending → error_during_execution。
  stdin.on("error", () => {});

  let alive = !options.signal?.aborted;
  let exited = false;
  let flight = false;
  let turns = 0;
  let lastPatch = 0;
  let lastKind = "";
  let lastSummary = "";
  let buffer = "";
  let sessionId: string | null = null;
  let pauses = 0;
  let chain: Promise<void> = Promise.resolve();
  let pending: { resolve: (r: ExecutorResult) => void; outputFile: string } | null = null;
  let closedResolve!: () => void;
  const closed = new Promise<void>((r) => {
    closedResolve = r;
  });

  const killTree = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 2000).unref();
  };
  const onAbort = () => killTree();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const failPending = async () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    flight = false;
    // CLI 崩溃/被杀:无 result 事件,按 transient 合成,交给重试层。
    await writeFile(
      p.outputFile,
      `${JSON.stringify({ subtype: "error_during_execution", is_error: true, num_turns: turns })}\n`,
    ).catch(() => {});
    p.resolve({ ok: false, subtype: "error_during_execution", isError: true });
  };

  const handleEvent = async (event: StreamEvent) => {
    await appendEvent(options.worktrees, options.issue, event as Record<string, unknown>);
    const summary = summarize(event);
    if (summary) {
      lastKind = summary.kind;
      lastSummary = summary.summary;
    }
    // api_retry 等无摘要事件也刷新 lastEvent.ts,否则 provider 抖动期会被误判 stall。
    const now = Date.now();
    if (now - lastPatch >= 1000) {
      lastPatch = now;
      await patchStatus(options.worktrees, options.issue, {
        lastEvent: summary
          ? { ts: now, kind: summary.kind, summary: summary.summary }
          : { ts: now, kind: lastKind || event.type || "event", summary: lastSummary },
        turns,
      }).catch(() => {});
    }
    if (event.type !== "result") return;
    // pause_turn 是后端轮边界而非任务完成:自动续一句,保住 run() 的 resolve 契约
    // (resolve = 模型真正做完)。超限按行为类失败处理,防死循环。
    if (event.stop_reason === "pause_turn" && pending) {
      pauses += 1;
      if (pauses <= 10 && alive) {
        await appendEvent(options.worktrees, options.issue, {
          type: "agent",
          subtype: "pause-continue",
          count: pauses,
        }).catch(() => {});
        try {
          stdin.write(userMessage("Continue."));
        } catch {}
        return;
      }
    }
    const { message: _message, ...result } = event;
    // 无 pending 的 result 是 nudge 等孤儿轮的产物:落盘但不归因。
    if (!pending) return;
    const p = pending;
    pending = null;
    await writeFile(p.outputFile, `${JSON.stringify(result)}\n`);
    await patchStatus(options.worktrees, options.issue, { turns }).catch(() => {});
    if (result.stop_reason === "pause_turn") {
      p.resolve({ ok: false, subtype: "error_pause_loop", isError: true });
      return;
    }
    p.resolve({
      ok: result.is_error !== true,
      subtype: result.subtype ?? "",
      isError: result.is_error === true,
    });
  };

  const handleLine = (line: string) => {
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }
    if (typeof event.num_turns === "number") turns = Math.max(turns, event.num_turns);
    else if (event.type === "assistant") turns += 1;
    if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string")
      sessionId = event.session_id;
    // flight 同步复位,close 竞态窗口内 watchdog 不会把 nudge 错注进下一轮;
    // pause_turn 不算轮结束(会自动续跑)。
    if (event.type === "result" && event.stop_reason !== "pause_turn") flight = false;
    chain = chain.then(() => handleEvent(event));
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleLine(line);
    }
  });
  child.on("error", () => {
    alive = false;
  });
  child.on("close", () => {
    exited = true;
    alive = false;
    options.signal?.removeEventListener("abort", onAbort);
    chain = chain.then(async () => {
      if (buffer.trim()) handleLine(buffer);
      await failPending();
      closedResolve();
    });
    chain.catch(() => closedResolve());
  });
  // 会话生于已中止信号(如 claim 已丢失):立即杀,close 处理器合成 transient 失败。
  if (options.signal?.aborted) killTree();

  return {
    run(promptFile, outputFile) {
      if (pending) throw new Error("concurrent run on agent session");
      if (!alive)
        return Promise.resolve({ ok: false, subtype: "error_during_execution", isError: true });
      return new Promise<ExecutorResult>((resolve) => {
        void (async () => {
          const text = await readFile(promptFile, "utf8");
          pending = { resolve, outputFile };
          flight = true;
          pauses = 0;
          try {
            stdin.write(userMessage(text));
          } catch {
            flight = false;
            pending = null;
            resolve({ ok: false, subtype: "error_during_execution", isError: true });
          }
        })().catch(() => {
          flight = false;
          pending = null;
          resolve({ ok: false, subtype: "error_during_execution", isError: true });
        });
      });
    },
    sendNudge(text) {
      if (!alive || !flight) return;
      try {
        stdin.write(userMessage(text));
      } catch {}
    },
    inFlight: () => flight,
    isAlive: () => alive,
    sessionId: () => sessionId,
    async close() {
      options.signal?.removeEventListener("abort", onAbort);
      if (!exited) {
        alive = false;
        try {
          stdin.end();
        } catch {}
        const delay = (ms: number) =>
          new Promise<void>((r) => {
            setTimeout(r, ms).unref();
          });
        await Promise.race([closed, delay(5000)]);
        if (!exited) {
          killTree();
          await Promise.race([closed, delay(3000)]);
        }
      }
      await failPending();
    },
  };
}
