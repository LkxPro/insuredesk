import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ChangelogEntry, type ChangelogFile, changelogFileSchema } from "@insuredesk/shared";
import { type BrowserContext, chromium } from "playwright";
import { parse } from "yaml";
import {
  assertDevStackRunning,
  DEVICE_SCALE_FACTOR,
  resolveBaseURL,
  SCREENSHOT_VIEWPORT,
  setupEnv,
} from "./dev-stack.ts";

const repoRoot = join(import.meta.dirname, "../..");

export interface ScreenshotTarget {
  page: string;
  screenshot: string;
  outputPath: string;
  setupScript: string | null;
}

export function setupScriptFor(outputDir: string, screenshot: string): string | null {
  const candidate = join(outputDir, `${screenshot.slice(0, -".png".length)}.setup.ts`);
  return existsSync(candidate) ? candidate : null;
}

export function selectScreenshotTargets(
  entries: ChangelogEntry[],
  outputDir: string,
): ScreenshotTarget[] {
  const targets: ScreenshotTarget[] = [];
  for (const entry of entries) {
    if (!entry.page || !entry.screenshot) continue;
    targets.push({
      page: entry.page,
      screenshot: entry.screenshot,
      outputPath: join(outputDir, entry.screenshot),
      setupScript: setupScriptFor(outputDir, entry.screenshot),
    });
  }
  return targets;
}

export function loadChangelog(yamlPath: string): ChangelogFile {
  const parsed = changelogFileSchema.safeParse(parse(readFileSync(yamlPath, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(根)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`changelog 不合规：${yamlPath}\n${issues}`);
  }
  return parsed.data;
}

async function login(context: BrowserContext): Promise<void> {
  // dev seed 的演示账号（apps/api/prisma/seed-data.ts）：全角色同密码。
  const username = process.env.SCREENSHOT_USERNAME ?? "admin";
  const password = process.env.SCREENSHOT_PASSWORD ?? "password123";
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  } catch (err) {
    throw new Error(`dev 登录失败（${username}）：${(err as Error).message}`);
  } finally {
    await page.close();
  }
}

function runSetup(script: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [script], { cwd: repoRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`setup 脚本退出码 ${result.status ?? "signal"}：${script}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  const [yamlArg] = argv;
  if (!yamlArg) {
    console.error("用法：node scripts/release/screenshot.ts <changelog/v<版本>.yaml>");
    return 1;
  }
  const yamlPath = resolve(yamlArg);
  if (!existsSync(yamlPath)) {
    console.error(`changelog 不存在：${yamlArg}`);
    return 1;
  }

  let file: ChangelogFile;
  try {
    file = loadChangelog(yamlPath);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const outputDir = join(dirname(yamlPath), file.version);
  const targets = selectScreenshotTargets(file.entries, outputDir);
  for (const entry of file.entries) {
    if (entry.page && !entry.screenshot) {
      console.log(`· 跳过（有 page 无 screenshot）：${entry.user}`);
    }
  }
  if (targets.length === 0) {
    console.log("无 page 条目，未产生截图");
    return 0;
  }

  const baseURL = resolveBaseURL();
  try {
    await assertDevStackRunning(baseURL);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  console.log(`→ ${targets.length} 条待截图，baseURL ${baseURL}`);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: SCREENSHOT_VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });
    await login(context);
    mkdirSync(outputDir, { recursive: true });
    for (const target of targets) {
      if (target.setupScript) {
        console.log(`→ setup ${relative(repoRoot, target.setupScript)}`);
        runSetup(target.setupScript, setupEnv(baseURL));
      }
      const page = await context.newPage();
      try {
        await page.goto(target.page, { waitUntil: "networkidle" });
        await page.screenshot({ path: target.outputPath });
      } finally {
        await page.close();
      }
      console.log(`✓ ${relative(repoRoot, target.outputPath)}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`✓ ${targets.length} 张截图完成`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`截图失败：${(err as Error).message}`);
      process.exitCode = 1;
    },
  );
}
