import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { callGh, callGit, NetCallError, run } from "./net.ts";

const execFileAsync = promisify(execFile);

let dir: string;
let callsFile: string;

let flaky: string;
let permanent: string;
let notFound: string;
let sslFlaky: string;
let eofFlaky: string;
let slow: string;
let ghCat: string;
let ghInputCat: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "net-test-"));
  callsFile = join(dir, "calls");
  const make = (name: string, body: string) => {
    const path = join(dir, name);
    return { path, body };
  };
  const scripts = [
    make(
      "flaky",
      `if [ "$n" -lt 3 ]; then
  echo 'fatal: unable to connect to remote: connection reset by peer' >&2
  exit 128
fi
printf 'eventual-ok\\n'`,
    ),
    make(
      "permanent",
      `echo '! [remote rejected] main (stale info)' >&2
exit 1`,
    ),
    make(
      "not-found",
      `echo 'GraphQL: Could not resolve to an issue or pull request with the number of 999999.' >&2
exit 1`,
    ),
    make(
      "ssl-flaky",
      `if [ "$n" -lt 3 ]; then
  echo "fatal: unable to access 'https://github.com/x/y.git/': LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443" >&2
  exit 128
fi
printf 'eventual-ok\\n'`,
    ),
    make(
      "eof-flaky",
      `if [ "$n" -lt 3 ]; then
  echo 'Post "https://api.github.com/graphql": EOF' >&2
  exit 1
fi
printf 'eventual-ok\\n'`,
    ),
    make("slow", "sleep 30"),
    make("gh-cat", "cat"),
    make(
      "gh-input-cat",
      `while [ $# -gt 0 ]; do
  if [ "$1" = --input ] && [ "$2" = - ]; then cat; shift 2; else shift; fi
done`,
    ),
  ];
  for (const { path, body } of scripts) {
    await writeFile(
      path,
      `#!/bin/sh
n=$(cat "$CALLS" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s\\n' "$n" >"$CALLS"
${body}
`,
    );
    await chmod(path, 0o755);
  }
  const paths = scripts.map((s) => s.path) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  [flaky, permanent, notFound, sslFlaky, eofFlaky, slow, ghCat, ghInputCat] = paths;
  await writeFile(callsFile, "");
  process.env.CALLS = callsFile;
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const resetCalls = async () => {
  await writeFile(callsFile, "");
};
const calls = async () => Number.parseInt(await readFile(callsFile, "utf8"), 10);

test("transient 重试到成功；半截 stdout 不放行", async () => {
  await resetCalls();
  const out = await run(flaky, [], { baseDelaySeconds: 0 });
  assert.equal(out, "eventual-ok\n");
  assert.equal(await calls(), 3);
});

test("确定性错误（lease 拒绝）不重试", async () => {
  await resetCalls();
  await assert.rejects(run(permanent, [], { baseDelaySeconds: 0 }), (error: unknown) => {
    assert.ok(error instanceof NetCallError);
    assert.equal(error.attemptsMade, 1);
    return true;
  });
  assert.equal(await calls(), 1);
});

test("issue 404 不误判为 DNS 抖动", async () => {
  await resetCalls();
  await assert.rejects(run(notFound, [], { baseDelaySeconds: 0 }));
  assert.equal(await calls(), 1);
});

test("transient 打满 attempts 后放弃", async () => {
  await resetCalls();
  await assert.rejects(run(flaky, [], { attempts: 2, baseDelaySeconds: 0 }));
  assert.equal(await calls(), 2);
});

test("LibreSSL 抖动特征是传输层错误，必须重试", async () => {
  await resetCalls();
  const out = await run(sslFlaky, [], { baseDelaySeconds: 0 });
  assert.equal(out, "eventual-ok\n");
  assert.equal(await calls(), 3);
});

test("gh graphql EOF(带尾部换行)按传输层错误重试", async () => {
  await resetCalls();
  const out = await run(eofFlaky, [], { baseDelaySeconds: 0 });
  assert.equal(out, "eventual-ok\n");
  assert.equal(await calls(), 3);
});

test("看门狗超时按 transient 处理并杀整棵进程树", async () => {
  await resetCalls();
  await assert.rejects(
    run(slow, [], {
      attempts: 2,
      baseDelaySeconds: 0,
      timeoutSeconds: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof NetCallError);
      assert.equal(error.status, 124);
      return true;
    },
  );
  assert.equal(await calls(), 2);
});

test("run 执行任意命令并返回成功 stdout", async () => {
  const out = await run("printf", ["direct-ok\n"]);
  assert.equal(out, "direct-ok\n");
});

test("callGit 在指定目录执行 git", async () => {
  const repo = await mkdtemp(join(tmpdir(), "net-git-"));
  try {
    await execFileAsync("git", ["-C", repo, "init", "-q"]);
    const out = await callGit(repo, ["rev-parse", "--show-toplevel"]);
    assert.equal(out, `${await realpath(repo)}\n`);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("callGh 走 AGENT_LOOP_GH 指向的 gh 并透传 stdin", async () => {
  const saved = process.env.AGENT_LOOP_GH;
  process.env.AGENT_LOOP_GH = ghCat;
  try {
    const out = await callGh(["api", "--input", "-"], "payload\n");
    assert.equal(out, "payload\n");
  } finally {
    if (saved === undefined) delete process.env.AGENT_LOOP_GH;
    else process.env.AGENT_LOOP_GH = saved;
  }
});

const cli = fileURLToPath(new URL("./net-cli.ts", import.meta.url));

const runCli = (
  gh: string,
  args: string[],
  input?: string,
): Promise<{ code: number | null; stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, AGENT_LOOP_GH: gh },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (!child.stdout || (input !== undefined && !child.stdin))
      throw new Error("child stdio not piped");
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    if (input !== undefined) child.stdin?.end(input);
  });

test("net-cli 看门狗超时以 124 退出", async () => {
  const { code } = await runCli(slow, ["--timeout-seconds", "1", "--"]);
  assert.equal(code, 124);
});

test("net-cli 把 --input - 的 stdin 透传给命令", async () => {
  const { code, stdout } = await runCli(ghInputCat, ["--", "api", "--input", "-"], "payload\n");
  assert.equal(code, 0);
  assert.equal(stdout, "payload\n");
});
