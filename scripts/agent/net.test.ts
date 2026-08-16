import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NetCallError, netCall } from "./net.ts";

let dir: string;
let callsFile: string;

let flaky: string;
let permanent: string;
let notFound: string;
let sslFlaky: string;
let eofFlaky: string;
let slow: string;

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
  const paths = scripts.map((s) => s.path) as [string, string, string, string, string, string];
  [flaky, permanent, notFound, sslFlaky, eofFlaky, slow] = paths;
  await writeFile(callsFile, "");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const resetCalls = async () => {
  await writeFile(callsFile, "");
};
const calls = async () => Number.parseInt(await readFile(callsFile, "utf8"), 10);

const env = () => ({ ...process.env, CALLS: callsFile });

test("transient 重试到成功；半截 stdout 不放行", async () => {
  await resetCalls();
  const out = await netCall(flaky, [], { baseDelaySeconds: 0, env: env() });
  assert.equal(out, "eventual-ok\n");
  assert.equal(await calls(), 3);
});

test("确定性错误（lease 拒绝）不重试", async () => {
  await resetCalls();
  await assert.rejects(
    netCall(permanent, [], { baseDelaySeconds: 0, env: env() }),
    (error: unknown) => {
      assert.ok(error instanceof NetCallError);
      assert.equal(error.attemptsMade, 1);
      return true;
    },
  );
  assert.equal(await calls(), 1);
});

test("issue 404 不误判为 DNS 抖动", async () => {
  await resetCalls();
  await assert.rejects(netCall(notFound, [], { baseDelaySeconds: 0, env: env() }));
  assert.equal(await calls(), 1);
});

test("transient 打满 attempts 后放弃", async () => {
  await resetCalls();
  await assert.rejects(netCall(flaky, [], { attempts: 2, baseDelaySeconds: 0, env: env() }));
  assert.equal(await calls(), 2);
});

test("LibreSSL 抖动特征是传输层错误，必须重试", async () => {
  await resetCalls();
  const out = await netCall(sslFlaky, [], { baseDelaySeconds: 0, env: env() });
  assert.equal(out, "eventual-ok\n");
  assert.equal(await calls(), 3);
});

test("gh graphql EOF(带尾部换行)按传输层错误重试", async () => {
  await resetCalls();
  const out = await netCall(eofFlaky, [], { baseDelaySeconds: 0, env: env() });
  assert.equal(out, "eventual-ok\n");
  assert.equal(await calls(), 3);
});

test("看门狗超时按 transient 处理并杀整棵进程树", async () => {
  await resetCalls();
  await assert.rejects(
    netCall(slow, [], {
      attempts: 2,
      baseDelaySeconds: 0,
      attemptTimeoutSeconds: 1,
      env: env(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof NetCallError);
      assert.equal(error.status, 124);
      return true;
    },
  );
  assert.equal(await calls(), 2);
});
