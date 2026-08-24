import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commentIssue, editIssue, ghCall, ghJson } from "./gh.ts";
import { callGit } from "./net.ts";

const log = (msg: string) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`);

// 子票 body 首个 marker 由 plan.mjs 写入,格式 <!-- agent-plan:<parent>:<key> -->。
export function planParentOf(body: string | undefined): number {
  const match = /<!-- agent-plan:([0-9]+):[a-z0-9][a-z0-9-]* -->/.exec(body ?? "");
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

export function baseBranchOf(body: string | undefined): string {
  const parent = planParentOf(body);
  return parent > 0 ? `agent/spec-${parent}` : "main";
}

// 跨 clone 并发补建同一 spec 分支时 push 必有一方失败:失败后复查远端,已存在即竞争落空。
export async function ensureSpecBranch(root: string, branch: string): Promise<void> {
  const remote = await callGit(root, ["ls-remote", "origin", branch]);
  if (remote.trim() === "") {
    await callGit(root, ["push", "origin", `origin/main:refs/heads/${branch}`]).catch(async () => {
      const recheck = await callGit(root, ["ls-remote", "origin", branch]);
      if (recheck.trim() === "") throw new Error(`cannot create spec branch ${branch}`);
    });
  }
  await callGit(root, ["fetch", "origin", branch]);
}

interface SubIssue {
  number: number;
  state: string;
  title: string;
}

async function subIssues(parent: number): Promise<SubIssue[]> {
  const text = await ghCall([
    "api",
    `repos/{owner}/{repo}/issues/${parent}/sub_issues`,
    "--paginate",
    "--jq",
    '.[] | "\\(.number)\t\\(.state)\t\\(.title)"',
  ]);
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [number = "", state = "", title = ""] = line.split("\t");
      return { number: Number.parseInt(number, 10), state, title };
    });
}

function finalPrBody(parent: number, subs: SubIssue[]): string {
  const list = subs.map((sub) => `- #${sub.number} ${sub.title}`).join("\n");
  return `Closes #${parent}\n\n所有子票已并入 \`agent/spec-${parent}\`,本 PR 不自动合并,等人工 review。\n\n## 子票\n${list}\n`;
}

// 子 PR 已合并但 issue 未关(agent-merge.yml 关单失败)会让完成检测永久卡死且无信号;
// 不自动豁免(推断映射太脆),只在父 issue 报一次异常。
async function reportMergedButOpen(parent: number, openSubs: SubIssue[]): Promise<void> {
  const comments = await ghJson<Array<{ body: string }>>([
    "issue",
    "view",
    String(parent),
    "--json",
    "comments",
    "--jq",
    ".comments",
  ]).catch(() => []);
  for (const sub of openSubs) {
    const merged = await ghJson<Array<{ number: number }>>([
      "pr",
      "list",
      "--head",
      `codex/issue-${sub.number}`,
      "--state",
      "merged",
      "--json",
      "number",
      "--limit",
      "1",
    ]).catch(() => []);
    if (merged.length === 0) continue;
    const marker = `<!-- agent-spec-anomaly:${sub.number} -->`;
    if (comments.some((comment) => comment.body.includes(marker))) continue;
    await commentIssue(
      parent,
      `${marker} 子票 #${sub.number} 的 PR 已合并但 issue 仍 open,spec 完成检测被卡住;请人工关闭 #${sub.number}。`,
    );
  }
}

async function finalizeSpec(
  root: string,
  parent: { number: number; title: string; labels: Array<{ name: string }> },
): Promise<void> {
  if (parent.labels.some((label) => label.name === "agent:blocked")) return;
  const branch = `agent/spec-${parent.number}`;
  if ((await callGit(root, ["ls-remote", "origin", branch])).trim() === "") return;
  await callGit(root, ["fetch", "origin", "main", branch]);

  const subs = await subIssues(parent.number);
  const openSubs = subs.filter((sub) => sub.state.toUpperCase() !== "CLOSED");
  if (openSubs.length > 0) {
    await reportMergedButOpen(parent.number, openSubs);
    return;
  }
  const openChildPrs = await ghJson<Array<{ number: number }>>([
    "pr",
    "list",
    "--base",
    branch,
    "--state",
    "open",
    "--json",
    "number",
  ]);
  if (openChildPrs.length > 0) return;
  const ahead = (
    await callGit(root, ["rev-list", "--count", `origin/main..origin/${branch}`])
  ).trim();
  if (ahead === "0") return;

  const body = finalPrBody(parent.number, subs);
  const existing = await ghJson<Array<{ number: number; body: string }>>([
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "number,body",
  ]);
  // final PR 已存在:补发的新子票只刷新 body,main 同步归人工,避免 review 中途被 merge 打断。
  const existingPr = existing[0];
  if (existingPr) {
    if (existingPr.body.trim() !== body.trim())
      await ghCall(["pr", "edit", String(existingPr.number), "--body", body]);
    return;
  }

  // daemon 的 root 是人工活 checkout,merge 必须在临时 detached worktree 执行。
  const tmp = await mkdtemp(join(tmpdir(), `spec-finalize-${parent.number}-`));
  const snap = join(tmp, "wt");
  try {
    await callGit(root, ["worktree", "add", "--detach", snap, `origin/${branch}`]);
    const merged = await callGit(snap, [
      "-c",
      "user.name=insuredesk-agent",
      "-c",
      "user.email=insuredesk-agent@users.noreply.github.com",
      "merge",
      "--no-edit",
      "origin/main",
    ])
      .then(() => true)
      .catch(() => false);
    if (!merged) {
      await editIssue(parent.number, { add: ["agent:blocked"] });
      await commentIssue(
        parent.number,
        `main 与 \`${branch}\` 合并冲突,spec 收尾转人工:人工合并 main 进 ${branch} 并推送后摘掉 agent:blocked,daemon 会继续收尾。`,
      );
      return;
    }
    // push 被拒(跨 clone 竞争)直接抛出:下 tick 重取重验,open-PR 护栏保证幂等。
    await callGit(snap, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    const url = await ghCall([
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `Spec: ${parent.title} (#${parent.number})`,
      "--body",
      body,
    ]);
    const pr = Number.parseInt(url.trim().split("/").pop() ?? "", 10);
    await commentIssue(
      parent.number,
      `全部子票完成,final PR${Number.isInteger(pr) ? ` #${pr}` : ""} 已开(无 automerge)。人工 review 并合并后本 spec 自动关闭。`,
    );
  } finally {
    await callGit(root, ["worktree", "remove", "--force", snap]).catch(() => {});
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function finalizeSpecs(root: string): Promise<void> {
  const parents = await ghJson<
    Array<{ number: number; title: string; labels: Array<{ name: string }> }>
  >([
    "issue",
    "list",
    "--label",
    "agent:spec",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,labels",
  ]);
  for (const parent of parents) {
    await finalizeSpec(root, parent).catch((error) => {
      log(`finalize spec #${parent.number} failed: ${error}`);
    });
  }
}
