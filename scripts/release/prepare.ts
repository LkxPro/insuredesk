import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHANGELOG_VERSION_PATTERN,
  type ChangelogFile,
  changelogFileSchema,
} from "@insuredesk/shared";
import { parse } from "yaml";
import { validateChangelogFile } from "../changelog/validate.ts";

export interface MergedPR {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  author?: { login: string } | null;
  labels?: { name: string }[];
}

export interface ClosedIssue {
  number: number;
  title: string;
  url: string;
  closedAt: string;
  labels?: { name: string }[];
}

export interface ReleaseMaterials {
  version: string;
  lastTag: string | null;
  since: string;
  prs: MergedPR[];
  issues: ClosedIssue[];
  routeDiff: string;
}

function shanghaiParts(now: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function computeNextVersion(tags: string[], now: Date): string {
  const { year, month } = shanghaiParts(now);
  const prefix = `v${year}.${month}.`;
  let max = -1;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;
    const rest = tag.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    max = Math.max(max, Number(rest));
  }
  return `${prefix}${max + 1}`;
}

// CalVer 序号段不补零，版本须按数值比较
export function latestVersionTag(tags: string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    if (!CHANGELOG_VERSION_PATTERN.test(tag)) continue;
    if (best === null || compareVersions(tag, best) > 0) best = tag;
  }
  return best;
}

function compareVersions(a: string, b: string): number {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < pa.length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function renderMaterials(m: ReleaseMaterials): string {
  const prLines = m.prs
    .map((pr) => {
      const labels = (pr.labels ?? []).map((l) => l.name).join(", ");
      const meta = [
        pr.mergedAt.slice(0, 10),
        pr.author ? `@${pr.author.login}` : null,
        labels ? `labels: ${labels}` : null,
      ]
        .filter(Boolean)
        .join("，");
      return `- #${pr.number} ${pr.title} — ${pr.url}（${meta}）`;
    })
    .join("\n");
  const issueLines = m.issues
    .map((issue) => {
      const labels = (issue.labels ?? []).map((l) => l.name).join(", ");
      const meta = [issue.closedAt.slice(0, 10), labels ? `labels: ${labels}` : null]
        .filter(Boolean)
        .join("，");
      return `- #${issue.number} ${issue.title} — ${issue.url}（${meta}）`;
    })
    .join("\n");

  return `# ${m.version} 发版素材

- 上一版本：${m.lastTag ?? "无（首次发版）"}
- 收集区间：${m.since} 起合并的 PR / 关闭的 issue

## 已合并 PR（${m.prs.length}）

${prLines || "（无）"}

## 已关闭 issue（${m.issues.length}）

${issueLines || "（无）"}

## apps/web 路由 diff（${m.lastTag ?? "无 tag"}..HEAD）

\`\`\`diff
${m.routeDiff || "（无变化，或本地缺少上一版本 tag：git fetch --tags 后重跑）"}
\`\`\`

## 下一步

按 \`.claude/skills/release-prepare/SKILL.md\` 起草 \`changelog/${m.version}.yaml\` 的
entries，然后重跑 \`make release-prepare\` 完成截图与开 PR。
`;
}

export function renderDraftYaml(version: string, date: string): string {
  return `version: ${version}
date: ${date}
# TODO: 按 .release-prepare/${version}/materials.md 起草 entries；指引见 .claude/skills/release-prepare/SKILL.md
entries: []
`;
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

// GitHub GraphQL 网关偶发 5xx/EOF，隔几秒重试通常即恢复
const GH_TRANSIENT = /HTTP 5\d\d|\bEOF\b|timed out|timeout|connection reset/i;

export function isTransientGhError(message: string): boolean {
  return GH_TRANSIENT.test(message);
}

function gh(repoRoot: string, args: string[]): string {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("gh", args, { cwd: repoRoot, encoding: "utf8" });
    } catch (err) {
      if (attempt >= 4 || !isTransientGhError((err as Error).message)) throw err;
      execFileSync("sleep", [String(2 ** (attempt - 1))]);
    }
  }
}

function remoteTags(repoRoot: string): string[] {
  const out = git(repoRoot, ["ls-remote", "--tags", "origin"]);
  const tags: string[] = [];
  for (const line of out.split("\n")) {
    const match = line.match(/refs\/tags\/(v\d{4}\.\d{2}\.\d+)$/);
    if (match) tags.push(match[1] as string);
  }
  return tags;
}

function releasePublishedAt(repoRoot: string, tag: string): string {
  return gh(repoRoot, [
    "release",
    "view",
    tag,
    "--json",
    "publishedAt",
    "--jq",
    ".publishedAt",
  ]).trim();
}

function routeDiff(repoRoot: string, lastTag: string | null): string {
  if (!lastTag) return "";
  try {
    git(repoRoot, ["rev-parse", "--verify", `refs/tags/${lastTag}`]);
  } catch {
    return "";
  }
  return git(repoRoot, [
    "diff",
    `${lastTag}..HEAD`,
    "--",
    "apps/web/src/AppRoutes.tsx",
    "apps/web/src/lib/navigation.ts",
  ]).trim();
}

function collect(repoRoot: string, version: string, tags: string[], now: Date): number {
  const lastTag = latestVersionTag(tags);
  try {
    git(repoRoot, ["fetch", "--tags", "origin"]);
  } catch {
    // routeDiff 靠本地 tag ref，worktree/浅克隆常缺；拉不到按既有缺 tag 逻辑降级为空
  }
  const since = lastTag ? releasePublishedAt(repoRoot, lastTag).slice(0, 10) : "1970-01-01";
  const prs = JSON.parse(
    gh(repoRoot, [
      "pr",
      "list",
      "--state",
      "merged",
      "--base",
      "main",
      "--limit",
      "200",
      "--search",
      `merged:>=${since}`,
      "--json",
      "number,title,url,mergedAt,author,labels",
    ]),
  ) as MergedPR[];
  const issues = JSON.parse(
    gh(repoRoot, [
      "issue",
      "list",
      "--state",
      "closed",
      "--limit",
      "200",
      "--search",
      `closed:>=${since}`,
      "--json",
      "number,title,url,closedAt,labels",
    ]),
  ) as ClosedIssue[];

  const bundleDir = join(repoRoot, ".release-prepare", version);
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(join(repoRoot, "changelog"), { recursive: true });
  writeFileSync(
    join(bundleDir, "materials.md"),
    renderMaterials({
      version,
      lastTag,
      since,
      prs,
      issues,
      routeDiff: routeDiff(repoRoot, lastTag),
    }),
  );
  const { year, month, day } = shanghaiParts(now);
  writeFileSync(
    join(repoRoot, "changelog", `${version}.yaml`),
    renderDraftYaml(version, `${year}-${month}-${day}`),
  );

  console.log(`✓ 下一版本 ${version}（上一版本 ${lastTag ?? "无"}）`);
  console.log(
    `✓ 素材包 ${relative(repoRoot, join(bundleDir, "materials.md"))}（${prs.length} 个 PR、${issues.length} 个 issue）`,
  );
  console.log(`✓ 草稿 changelog/${version}.yaml`);
  console.log(
    "下一步：起 agent 按 .claude/skills/release-prepare/SKILL.md 起草 entries，然后重跑 make release-prepare",
  );
  return 0;
}

function loadDraft(yamlPath: string): ChangelogFile | null {
  const parsed = changelogFileSchema.safeParse(parse(readFileSync(yamlPath, "utf8")));
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(根)"}: ${issue.message}`)
    .join("\n");
  console.error(`changelog 尚未起草完成或不合规：${relative(process.cwd(), yamlPath)}\n${issues}`);
  console.error("按 .claude/skills/release-prepare/SKILL.md 修订后重跑 make release-prepare");
  return null;
}

function runScreenshotter(yamlPath: string): number {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "screenshot.ts"), yamlPath],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function publish(repoRoot: string, version: string): number {
  const paths = [`changelog/${version}.yaml`];
  if (existsSync(join(repoRoot, "changelog", version))) paths.push(`changelog/${version}`);
  const onMain = git(repoRoot, ["branch", "--show-current"]).trim() === "main";
  if (onMain && !git(repoRoot, ["status", "--porcelain", "--", ...paths]).trim()) {
    console.log(`${paths.join("、")} 相对 HEAD 无改动（changelog 应已随主干合入），无需开 PR`);
    console.log("下一步：在 main 上跑 make release 触发发布");
    return 0;
  }
  const branch = `changelog/${version}`;
  try {
    git(repoRoot, ["checkout", "-b", branch]);
  } catch {
    git(repoRoot, ["checkout", branch]);
  }
  git(repoRoot, ["add", ...paths]);
  if (git(repoRoot, ["diff", "--cached", "--name-only"]).trim()) {
    git(repoRoot, ["commit", "-m", `docs(changelog): ${version} 更新日志`]);
  }
  git(repoRoot, ["push", "-u", "origin", branch]);

  const body = `本版本 changelog 草稿（yaml + 截图），由 make release-prepare 生成。

- 人工过目后 merge
- merge 后在 main 上跑 \`make release\` 触发发布`;
  try {
    const url = gh(repoRoot, [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `changelog: ${version}`,
      "--body",
      body,
    ]).trim();
    console.log(`✓ 已开 PR：${url}`);
  } catch (createErr) {
    try {
      const url = gh(repoRoot, ["pr", "view", branch, "--json", "url", "--jq", ".url"]).trim();
      console.log(`✓ PR 已存在，已推送更新：${url}`);
    } catch {
      throw new Error(
        `开 PR 失败且未查到既有 PR（分支 ${branch} 已推送，重跑可续）：${(createErr as Error).message}`,
      );
    }
  }
  console.log("人工过目 merge 后，在 main 上跑 make release 触发发布");
  return 0;
}

export function main(argv: string[]): number {
  const args = new Set(argv);
  const dryRun = args.delete("--dry-run");
  if (args.size > 0) {
    console.error("用法：node scripts/release/prepare.ts [--dry-run]");
    return 1;
  }

  let repoRoot: string;
  let tags: string[];
  try {
    repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    tags = remoteTags(repoRoot);
  } catch (err) {
    console.error(`读取远端 tag 失败（需在仓库内且 origin 可达）：${(err as Error).message}`);
    return 1;
  }

  const now = new Date();
  const version = computeNextVersion(tags, now);
  const yamlPath = join(repoRoot, "changelog", `${version}.yaml`);

  if (!existsSync(yamlPath)) {
    try {
      return collect(repoRoot, version, tags, now);
    } catch (err) {
      console.error(`收集发版素材失败（需 gh 已登录）：${(err as Error).message}`);
      return 1;
    }
  }

  if (!loadDraft(yamlPath)) return 1;
  if (runScreenshotter(yamlPath) !== 0) return 1;

  const errors = validateChangelogFile(yamlPath);
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`${e.file}:${e.line ?? 1}:${e.col ?? 1}: ${e.message}`);
    }
    console.error("截图后校验仍未通过，修订后重跑 make release-prepare");
    return 1;
  }

  if (dryRun) {
    console.log("dry-run：校验与截图完成，跳过建分支/开 PR");
    return 0;
  }
  return publish(repoRoot, version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`release-prepare 失败：${(err as Error).message}`);
    process.exitCode = 1;
  }
}
