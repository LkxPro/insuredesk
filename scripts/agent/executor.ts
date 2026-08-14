import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { appendEvent, patchStatus } from "./status.ts";

export interface ExecutorOptions {
  worktree: string;
  taskFile: string;
  outputFile: string;
  worktrees: string;
  issue: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ExecutorResult {
  ok: boolean;
  subtype: string;
  isError: boolean;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  num_turns?: number;
  message?: { content?: Array<{ type: string; name?: string; text?: string }> };
  [key: string]: unknown;
}

function summarize(event: StreamEvent): { kind: string; summary: string } | null {
  if (event.type === "assistant") {
    const content = event.message?.content ?? [];
    const tools = content.filter((c) => c.type === "tool_use").map((c) => c.name ?? "tool");
    if (tools.length) return { kind: tools.join(","), summary: "" };
    if (content.some((c) => c.type === "text")) return { kind: "text", summary: "" };
    return null;
  }
  if (event.type === "result") return { kind: "result", summary: event.subtype ?? "" };
  return null;
}

// claude -p --output-format stream-json --verbose：逐行 NDJSON,末行 result
// 事件与 --output-format json 的结果 JSON 同形。原始事件全量落 events.jsonl,
// 聚合心跳写 status.json(节流 1/s,写盘是 tmp+rename)。
export async function runExecutor(options: ExecutorOptions): Promise<ExecutorResult> {
  const claudeBin = process.env.AGENT_CLAUDE_BIN ?? "claude";
  const permissionMode = process.env.AGENT_CLAUDE_PERMISSION_MODE ?? "bypassPermissions";
  // headless -p 下权限弹窗等于自动拒绝，必须显式 bypass。
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (process.env.AGENT_MAX_TURNS) args.push("--max-turns", process.env.AGENT_MAX_TURNS);
  if (permissionMode === "bypassPermissions") args.push("--dangerously-skip-permissions");
  else args.push("--permission-mode", permissionMode);
  if (process.env.AGENT_MODEL) args.push("--model", process.env.AGENT_MODEL);

  const task = await readFile(options.taskFile, "utf8");
  const executorEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    AGENT_WORKTREE: options.worktree,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      cwd: options.worktree,
      detached: true,
      env: executorEnv,
      stdio: ["pipe", "pipe", "inherit"],
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

    let buffer = "";
    let resultEvent: StreamEvent | null = null;
    let turns = 0;
    let lastPatch = 0;

    const handleLine = async (line: string) => {
      let event: StreamEvent;
      try {
        event = JSON.parse(line) as StreamEvent;
      } catch {
        return;
      }
      await appendEvent(options.worktrees, options.issue, event as Record<string, unknown>);
      if (typeof event.num_turns === "number") turns = event.num_turns;
      else if (event.type === "assistant") turns += 1;
      const summary = summarize(event);
      const now = Date.now();
      if (summary && now - lastPatch >= 1000) {
        lastPatch = now;
        await patchStatus(options.worktrees, options.issue, {
          lastEvent: { ts: now, kind: summary.kind, summary: summary.summary },
          turns,
        }).catch(() => {});
      }
      if (event.type === "result") resultEvent = event;
    };

    let chain: Promise<void> = Promise.resolve();
    if (!child.stdout) throw new Error("child stdout not piped");
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        chain = chain.then(() => handleLine(line));
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      chain = chain.then(async () => {
        if (buffer.trim()) await handleLine(buffer);
        if (resultEvent !== null) {
          const { message: _message, ...result } = resultEvent as StreamEvent & {
            message?: unknown;
          };
          await writeFile(options.outputFile, `${JSON.stringify(result)}\n`);
          await patchStatus(options.worktrees, options.issue, { turns });
          resolve({
            ok: code === 0 && resultEvent.is_error !== true,
            subtype: resultEvent.subtype ?? "",
            isError: resultEvent.is_error === true,
          });
        } else {
          // CLI 崩溃/被杀：无 result 事件,按 transient 合成,交给重试层。
          await writeFile(
            options.outputFile,
            `${JSON.stringify({ subtype: "error_during_execution", is_error: true, num_turns: turns })}\n`,
          );
          resolve({ ok: false, subtype: "error_during_execution", isError: true });
        }
      });
      chain.catch(reject);
    });
    if (!child.stdin) throw new Error("child stdin not piped");
    child.stdin.end(task);
  });
}
