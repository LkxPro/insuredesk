import { callGh } from "./net.ts";

export function ghCall(args: string[], stdin?: string): Promise<string> {
  return callGh(args, stdin);
}

export async function ghJson<T>(args: string[], stdin?: string): Promise<T> {
  return JSON.parse(await ghCall(args, stdin)) as T;
}

export interface IssueRef {
  number: number;
  labels: Array<string | { name: string }>;
}

export interface Issue extends IssueRef {
  state: string;
  body: string;
  issue_dependencies_summary?: { blocked_by?: number };
}

export function hasLabel(issue: IssueRef, label: string): boolean {
  return issue.labels.some((l) => (typeof l === "string" ? l : l.name) === label);
}

export async function issueView(issue: number): Promise<Issue> {
  return ghJson<Issue>(["issue", "view", String(issue), "--json", "number,state,body,labels"]);
}

export async function queueIssues(): Promise<IssueRef[]> {
  const base = ["issue", "list", "--state", "open", "--limit", "100", "--json", "number,labels"];
  const [queued, running] = await Promise.all([
    ghJson<IssueRef[]>([...base, "--label", "agent:queued"]),
    ghJson<IssueRef[]>([...base, "--label", "agent:running"]),
  ]);
  const seen = new Map<number, IssueRef>();
  for (const issue of [...queued, ...running]) seen.set(issue.number, issue);
  return [...seen.values()];
}

// frontier 需要 blocked_by 计数，issue list 不返回，逐条 api 取全量。
export async function fetchFullIssues(refs: IssueRef[]): Promise<Issue[]> {
  return Promise.all(
    refs.map((ref) => ghJson<Issue>(["api", `repos/{owner}/{repo}/issues/${ref.number}`])),
  );
}

export async function editIssue(
  issue: number,
  options: { add?: string[]; remove?: string[] },
): Promise<void> {
  const args = ["issue", "edit", String(issue)];
  if (options.add?.length) args.push("--add-label", options.add.join(","));
  if (options.remove?.length) args.push("--remove-label", options.remove.join(","));
  await ghCall(args);
}

export async function commentIssue(issue: number, body: string): Promise<void> {
  await ghCall(["issue", "comment", String(issue), "--body", body]);
}

export async function syncDependencies(issue: number, body: string): Promise<void> {
  const after = body.split(/^#{2,3} Dependencies\s*$/m)[1] ?? "";
  const section = after.split(/^#{2,3} /m)[0] ?? "";
  const refs = [...section.matchAll(/#([0-9]+)/g)].map((m) => Number.parseInt(m[1] ?? "", 10));
  for (const blocker of new Set(refs)) {
    const blockerId = (
      await ghCall(["api", `repos/{owner}/{repo}/issues/${blocker}`, "--jq", ".id"])
    ).trim();
    try {
      await ghCall([
        "api",
        "--method",
        "POST",
        `repos/{owner}/{repo}/issues/${issue}/dependencies/blocked_by`,
        "-F",
        `issue_id=${blockerId}`,
      ]);
    } catch {
      // 重复依赖会 4xx；确认已存在则视为成功。
      const existing = (
        await ghCall([
          "api",
          `repos/{owner}/{repo}/issues/${issue}/dependencies/blocked_by`,
          "--paginate",
          "--jq",
          ".[].id",
        ])
      )
        .split("\n")
        .map((line) => line.trim());
      if (!existing.includes(blockerId))
        throw new Error(`cannot link dependency #${issue} blocked_by #${blocker}`);
    }
  }
}
