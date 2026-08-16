import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCREENSHOT_VIEWPORT = { width: 1280, height: 800 } as const;
export const DEVICE_SCALE_FACTOR = 2;

const repoRoot = join(import.meta.dirname, "../..");

export function resolveWebPort(): number {
  try {
    const out = execFileSync("sh", [join(repoRoot, "scripts/dev-ports.sh"), "--web-port"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const port = Number(out);
    if (Number.isInteger(port) && port > 0) return port;
  } catch {
    // 落到主检出默认口
  }
  return 5173;
}

export function resolveBaseURL(): string {
  return process.env.SCREENSHOT_BASE_URL ?? `http://127.0.0.1:${resolveWebPort()}`;
}

export async function isDevStackRunning(baseURL: string): Promise<boolean> {
  try {
    const response = await fetch(baseURL, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export function assertDevStackRunning(baseURL: string): Promise<void> {
  return isDevStackRunning(baseURL).then((running) => {
    if (!running) {
      throw new Error(`dev 栈未运行（${baseURL} 不可达）。先 make dev 起本地栈，再重跑截图。`);
    }
  });
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    out[match[1] as string] = (match[2] as string).trim().replace(/^"|"$/g, "");
  }
  return out;
}

export function setupEnv(baseURL: string): NodeJS.ProcessEnv {
  const apiEnv = readEnvFile(join(repoRoot, "apps/api/.env"));
  const env: NodeJS.ProcessEnv = { ...process.env, INSUREDESK_WEB_URL: baseURL };
  env.DATABASE_URL ??= apiEnv.DATABASE_URL;
  env.INSUREDESK_API_URL ??= apiEnv.PORT
    ? `http://localhost:${apiEnv.PORT}`
    : "http://localhost:3000";
  return env;
}
