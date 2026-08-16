import assert from "node:assert/strict";
import test from "node:test";
import { scrubSessionEnv } from "./session-env.ts";

test("scrubSessionEnv strips session identity, keeps provider credentials", () => {
  const env = {
    PATH: "/bin",
    ANTHROPIC_BASE_URL: "https://provider.example",
    ANTHROPIC_AUTH_TOKEN: "token",
    AGENT_LOOP_MAX_PARALLEL: "4",
    AI_AGENT: "claude-code",
    CLAUDECODE: "1",
    CLAUDE_PID: "123",
    CLAUDE_CODE_SESSION_ID: "session",
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/s.sock",
    CLAUDE_CODE_MESSAGING_TOKEN: "m",
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_EXECPATH: "/exec",
    CLAUDE_CODE_SSE_PORT: "25098",
    GIT_ASKPASS: "/askpass",
    VSCODE_GIT_IPC_HANDLE: "ipc",
  };
  const clean = scrubSessionEnv(env);
  assert.equal(clean.PATH, "/bin");
  assert.equal(clean.ANTHROPIC_BASE_URL, "https://provider.example");
  assert.equal(clean.ANTHROPIC_AUTH_TOKEN, "token");
  assert.equal(clean.AGENT_LOOP_MAX_PARALLEL, "4");
  for (const key of Object.keys(env))
    if (
      !["PATH", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "AGENT_LOOP_MAX_PARALLEL"].includes(
        key,
      )
    )
      assert.equal(key in clean, false, `${key} should be scrubbed`);
  assert.equal(env.CLAUDE_CODE_SESSION_ID, "session");
});
