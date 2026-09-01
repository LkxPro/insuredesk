import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  computeNextVersion,
  isTransientGhError,
  latestVersionTag,
  renderMaterials,
} from "./prepare.ts";

const prepareEntry = join(import.meta.dirname, "prepare.ts");

test("computeNextVersion：当月首版为 .0", () => {
  assert.equal(computeNextVersion([], new Date("2026-08-16T02:00:00Z")), "v2026.08.0");
});

test("computeNextVersion：月份按 Asia/Shanghai 而非 UTC", () => {
  assert.equal(computeNextVersion([], new Date("2026-08-31T16:00:00Z")), "v2026.09.0");
  assert.equal(computeNextVersion([], new Date("2026-12-31T16:00:00Z")), "v2027.01.0");
});

test("computeNextVersion：同月递增末位，序号按数值而非字典序", () => {
  const now = new Date("2026-08-16T02:00:00Z");
  assert.equal(computeNextVersion(["v2026.08.0", "v2026.08.2", "v2026.07.9"], now), "v2026.08.3");
  assert.equal(computeNextVersion(["v2026.08.9", "v2026.08.10"], now), "v2026.08.11");
});

test("computeNextVersion：忽略非 CalVer 与带后缀的 tag", () => {
  const now = new Date("2026-08-16T02:00:00Z");
  assert.equal(
    computeNextVersion(["v2026.08.1-beta", "v2026.08.x", "v2026.8.5", "latest"], now),
    "v2026.08.0",
  );
});

test("latestVersionTag：跨月取最新，序号按数值比较", () => {
  assert.equal(latestVersionTag(["v2026.07.3", "v2026.08.1", "v2026.08.10"]), "v2026.08.10");
  assert.equal(latestVersionTag([]), null);
  assert.equal(latestVersionTag(["latest", "v1.2.3"]), null);
});

test("isTransientGhError：5xx/EOF/超时/连接重置可重试，其余不可", () => {
  assert.ok(isTransientGhError("HTTP 502"));
  assert.ok(isTransientGhError("Post https://api.github.com/graphql: EOF"));
  assert.ok(isTransientGhError("net/http: TLS handshake timeout"));
  assert.ok(isTransientGhError("connection reset by peer"));
  assert.ok(!isTransientGhError("a pull request for branch already exists"));
});

test("renderMaterials：含上一版本、PR/issue 清单、路由 diff 与下一步指引", () => {
  const md = renderMaterials({
    version: "v2026.08.0",
    lastTag: "v2026.07.3",
    since: "2026-07-30",
    prs: [
      {
        number: 264,
        title: "feat: changelog 截图器",
        url: "https://github.com/LkxPro/insuredesk/pull/264",
        mergedAt: "2026-08-15T08:00:00Z",
        author: { login: "alice" },
        labels: [{ name: "agent:task" }],
      },
    ],
    issues: [
      {
        number: 250,
        title: "排班页偶发白屏",
        url: "https://github.com/LkxPro/insuredesk/issues/250",
        closedAt: "2026-08-10T09:00:00Z",
        labels: [{ name: "bug" }],
      },
    ],
    routeDiff:
      "diff --git a/apps/web/src/AppRoutes.tsx b/apps/web/src/AppRoutes.tsx\n+  /reports,\n",
  });
  assert.ok(md.includes("v2026.08.0"), md);
  assert.ok(md.includes("v2026.07.3"), md);
  assert.ok(md.includes("#264"), md);
  assert.ok(md.includes("feat: changelog 截图器"), md);
  assert.ok(md.includes("https://github.com/LkxPro/insuredesk/pull/264"), md);
  assert.ok(md.includes("#250"), md);
  assert.ok(md.includes("排班页偶发白屏"), md);
  assert.ok(md.includes("AppRoutes.tsx"), md);
  assert.ok(md.includes("SKILL.md"), md);
});

interface Fixture {
  work: string;
  ghLog: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const STUB_PRS = JSON.stringify([
  {
    number: 264,
    title: "feat: changelog 截图器",
    url: "https://github.com/LkxPro/insuredesk/pull/264",
    mergedAt: "2026-08-15T08:00:00Z",
    author: { login: "alice" },
    labels: [{ name: "agent:task" }],
  },
]);
const STUB_ISSUES = JSON.stringify([
  {
    number: 250,
    title: "排班页偶发白屏",
    url: "https://github.com/LkxPro/insuredesk/issues/250",
    closedAt: "2026-08-10T09:00:00Z",
    labels: [{ name: "bug" }],
  },
]);

function setupFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "release-prepare-"));
  // origin 是本地产物:发布测试真的 push(本地路径传输);agent 沙箱会给 origin
  // 追加 disabled:// pushurl 拦发布,置空 GIT_CONFIG_COUNT 还原成干净 CI 环境。
  const origin = join(root, "origin");
  const work = join(root, "work");
  for (const dir of [origin, work]) {
    git(root, ["init", "-q", "-b", "main", dir]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "test"]);
  }
  writeFileSync(join(origin, "README.md"), "origin\n");
  git(origin, ["add", "."]);
  git(origin, ["commit", "-qm", "init"]);
  git(origin, ["tag", "v2026.07.3"]);

  git(work, ["remote", "add", "origin", origin]);
  const routes = join(work, "apps/web/src/AppRoutes.tsx");
  mkdirSync(join(work, "apps/web/src"), { recursive: true });
  writeFileSync(routes, "const routes = ['/tickets'];\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-qm", "init"]);
  git(work, ["tag", "v2026.07.3"]);
  writeFileSync(routes, "const routes = ['/tickets', '/reports'];\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-qm", "add reports route"]);

  const ghDir = join(root, "bin");
  mkdirSync(ghDir);
  const ghLog = join(root, "gh.log");
  writeFileSync(
    join(ghDir, "gh"),
    `#!/bin/sh
echo "$*" >> "${ghLog}"
case "$1 $2" in
  "release view") echo "2026-07-30T10:00:00Z" ;;
  "pr list") cat "${join(root, "prs.json")}" ;;
  "pr create") echo "https://github.com/example/pull/1" ;;
  "pr view") echo "https://github.com/example/pull/1" ;;
  "issue list") cat "${join(root, "issues.json")}" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(ghDir, "gh"), 0o755);
  writeFileSync(join(root, "prs.json"), STUB_PRS);
  writeFileSync(join(root, "issues.json"), STUB_ISSUES);

  return {
    work,
    ghLog,
    env: { PATH: `${ghDir}:${process.env.PATH}`, GIT_CONFIG_COUNT: "0" },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runPrepare(fixture: Fixture, args: string[]) {
  return spawnSync(process.execPath, [prepareEntry, ...args], {
    cwd: fixture.work,
    encoding: "utf8",
    env: { ...process.env, ...fixture.env },
    timeout: 120_000,
  });
}

function ghLogOf(fixture: Fixture): string {
  return existsSync(fixture.ghLog) ? readFileSync(fixture.ghLog, "utf8") : "";
}

function collectDraft(fixture: Fixture) {
  const result = runPrepare(fixture, ["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const changelogDir = join(fixture.work, "changelog");
  const names = existsSync(changelogDir)
    ? spawnSync("ls", [changelogDir], { encoding: "utf8" })
        .stdout.trim()
        .split("\n")
        .filter((f) => f.endsWith(".yaml"))
    : [];
  assert.equal(names.length, 1, "应产出唯一草稿 yaml");
  const name = names[0] as string;
  const version = name.slice(0, -".yaml".length);
  return { result, version, yamlPath: join(changelogDir, name) };
}

test("干跑：产出素材包与草稿 yaml，版本自洽，不开 PR", () => {
  const fixture = setupFixture();
  try {
    const { version, yamlPath } = collectDraft(fixture);

    assert.match(version, /^v\d{4}\.\d{2}\.\d+$/);
    assert.notEqual(version, "v2026.07.3");

    const yaml = readFileSync(yamlPath, "utf8");
    assert.ok(yaml.includes(`version: ${version}`), yaml);
    assert.match(yaml, /^date: \d{4}-\d{2}-\d{2}$/m, yaml);
    assert.ok(yaml.includes("entries: []"), yaml);

    const materialsPath = join(fixture.work, ".release-prepare", version, "materials.md");
    assert.ok(existsSync(materialsPath), "素材包缺失");
    const materials = readFileSync(materialsPath, "utf8");
    assert.ok(materials.includes("v2026.07.3"), materials);
    assert.ok(materials.includes("#264"), materials);
    assert.ok(materials.includes("feat: changelog 截图器"), materials);
    assert.ok(materials.includes("#250"), materials);
    assert.ok(materials.includes("AppRoutes.tsx"), materials);
    assert.ok(materials.includes("SKILL.md"), materials);

    assert.ok(!ghLogOf(fixture).includes("pr create"), "干跑不得开 PR");
  } finally {
    fixture.cleanup();
  }
});

test("草稿 entries 为空时重跑报错提示起草", () => {
  const fixture = setupFixture();
  try {
    collectDraft(fixture);
    const again = runPrepare(fixture, []);
    assert.equal(again.status, 1);
    assert.ok(again.stderr.includes("entries"), again.stderr);
    assert.ok(!ghLogOf(fixture).includes("pr create"), "未完成草稿不得开 PR");
  } finally {
    fixture.cleanup();
  }
});

test("草稿合规时干跑：过校验与截图器，仍不开 PR", () => {
  const fixture = setupFixture();
  try {
    const { version, yamlPath } = collectDraft(fixture);
    writeFileSync(
      yamlPath,
      `version: ${version}\ndate: 2026-08-16\nentries:\n  - category: 内部\n    user: 升级依赖\n    full: 升级内部依赖版本，无用户可见变化。\n`,
    );
    const result = runPrepare(fixture, ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!ghLogOf(fixture).includes("pr create"), "干跑不得开 PR");
  } finally {
    fixture.cleanup();
  }
});

test("非 git 仓库目录运行报错退出 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-prepare-norepo-"));
  try {
    const result = spawnSync(process.execPath, [prepareEntry, "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("发布：合规草稿建 changelog 分支、提交 yaml、推送并开 PR", () => {
  const fixture = setupFixture();
  try {
    const { version, yamlPath } = collectDraft(fixture);
    writeFileSync(
      yamlPath,
      `version: ${version}\ndate: 2026-08-16\nentries:\n  - category: 内部\n    user: 升级依赖\n    full: 升级内部依赖版本，无用户可见变化。\n`,
    );

    const result = runPrepare(fixture, []);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("已开 PR"), result.stdout);

    const branch = git(fixture.work, ["branch", "--show-current"]).trim();
    assert.equal(branch, `changelog/${version}`);
    const committed = git(fixture.work, ["show", "--name-only", "--format=", "HEAD"]);
    assert.ok(committed.includes(`changelog/${version}.yaml`), committed);

    const ghLog = ghLogOf(fixture);
    assert.ok(ghLog.includes(`pr create --base main --head changelog/${version}`), ghLog);
  } finally {
    fixture.cleanup();
  }
});

test("发布：changelog 已随主干合入（无未提交改动）时不开空 PR，提示直接 make release", () => {
  const fixture = setupFixture();
  try {
    const { version, yamlPath } = collectDraft(fixture);
    writeFileSync(
      yamlPath,
      `version: ${version}\ndate: 2026-08-16\nentries:\n  - category: 内部\n    user: 升级依赖\n    full: 升级内部依赖版本，无用户可见变化。\n`,
    );
    git(fixture.work, ["add", `changelog/${version}.yaml`]);
    git(fixture.work, ["commit", "-qm", `docs(changelog): ${version}`]);

    const result = runPrepare(fixture, []);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("无需开 PR"), result.stdout);
    assert.ok(result.stdout.includes("make release"), result.stdout);
    assert.equal(git(fixture.work, ["branch", "--show-current"]).trim(), "main");
    assert.ok(!ghLogOf(fixture).includes("pr create"), "无改动不得开 PR");
  } finally {
    fixture.cleanup();
  }
});

test("发布：在 changelog 分支上重跑（如上次推送失败）不得跳过开 PR", () => {
  const fixture = setupFixture();
  try {
    const { version, yamlPath } = collectDraft(fixture);
    writeFileSync(
      yamlPath,
      `version: ${version}\ndate: 2026-08-16\nentries:\n  - category: 内部\n    user: 升级依赖\n    full: 升级内部依赖版本，无用户可见变化。\n`,
    );
    const first = runPrepare(fixture, []);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(git(fixture.work, ["branch", "--show-current"]).trim(), `changelog/${version}`);

    const second = runPrepare(fixture, []);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(!second.stdout.includes("无需开 PR"), second.stdout);
    const creates = ghLogOf(fixture).match(/pr create/g) ?? [];
    assert.equal(creates.length, 2, ghLogOf(fixture));
  } finally {
    fixture.cleanup();
  }
});
