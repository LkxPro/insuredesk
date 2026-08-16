import { spawn } from "node:child_process";

export interface NetCallOptions {
  attempts?: number;
  baseDelaySeconds?: number;
  attemptTimeoutSeconds?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}

export class NetCallError extends Error {
  readonly status: number;
  readonly stderr: string;
  readonly attemptsMade: number;

  constructor(message: string, status: number, stderr: string, attemptsMade: number) {
    super(message);
    this.status = status;
    this.stderr = stderr;
    this.attemptsMade = attemptsMade;
  }
}

// 传输层特征：命中即退避重试；确定性错误（lease 拒绝、4xx 校验）首败即返回。
const TRANSIENT =
  /connection (reset|refused|closed|aborted)|operation timed out|i\/o timeout|timed out|could not resolve host|temporary failure in name resolution|no route to host|network (is )?unreachable|tls handshake timeout|context deadline exceeded|unexpected eof|eof$|gnutls recv error|http 5[0-9][0-9]|returned error: 5[0-9][0-9]|rate limit|ssl_error_syscall|ssl routines|sslv3 alert|tlsv1 alert|handshake failure|securetransport/i;

function envInt(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = source[key];
  if (raw === undefined || raw === "" || !/^[0-9]+$/.test(raw)) return fallback;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : fallback;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

interface AttemptResult {
  status: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runOnce(command: string, args: string[], options: NetCallOptions): Promise<AttemptResult> {
  const timeoutSeconds =
    options.attemptTimeoutSeconds ?? envInt(process.env, "AGENT_NET_CALL_TIMEOUT_SECONDS", 30);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      env: options.env ?? process.env,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {}
      }
    };
    const watchdog = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 2000).unref();
    }, timeoutSeconds * 1000);
    watchdog.unref();
    if (!child.stdout || !child.stderr) throw new Error("child stdio not piped");
    const out = child.stdout;
    const err = child.stderr;
    out.setEncoding("utf8");
    err.setEncoding("utf8");
    out.on("data", (chunk: string) => {
      stdout += chunk;
    });
    err.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      // 保持与 shell 看门狗一致的状态语义：被杀一律按 transient 处理。
      const status =
        code ?? (timedOut ? 124 : signal === "SIGTERM" ? 143 : signal === "SIGKILL" ? 137 : 1);
      resolve({ status, stdout, stderr, timedOut });
    });
    if (options.stdin !== undefined) {
      if (!child.stdin) throw new Error("child stdin not piped");
      child.stdin.end(options.stdin);
    }
  });
}

// stdout 只在成功时返回，避免半截输出污染调用方的 JSON 解析。
export async function netCall(
  command: string,
  args: string[],
  options: NetCallOptions = {},
): Promise<string> {
  const attempts = options.attempts ?? envInt(process.env, "AGENT_NET_CALL_ATTEMPTS", 4);
  const baseDelay = options.baseDelaySeconds ?? envInt(process.env, "AGENT_NET_CALL_BASE_DELAY", 2);
  let delay = baseDelay;
  let attempt = 0;
  let last: AttemptResult | undefined;
  while (attempt < attempts) {
    attempt += 1;
    last = await runOnce(command, args, options);
    if (last.status === 0) return last.stdout;
    process.stderr.write(last.stderr);
    if (attempt >= attempts) break;
    const retriable =
      last.timedOut ||
      last.status === 124 ||
      last.status === 137 ||
      last.status === 143 ||
      // 子进程 stderr 带尾部换行,eof$ 这类尾锚必须先 trim。
      TRANSIENT.test(last.stderr.trimEnd());
    if (!retriable) break;    process.stderr.write(
      `net-call: attempt ${attempt} failed (transient); retrying in ${delay}s\n`,
    );
    await sleep(delay);
    delay *= 2;
  }
  throw new NetCallError(
    `${command} failed after ${attempt} attempt(s)`,
    last?.status ?? 1,
    last?.stderr ?? "",
    attempt,
  );
}

export function netCallFast(
  command: string,
  args: string[],
  options: NetCallOptions = {},
): Promise<string> {
  return netCall(command, args, {
    attempts: 2,
    attemptTimeoutSeconds: 15,
    ...options,
  });
}
