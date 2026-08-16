// 启动会话的身份变量渗入 worker/claude 子进程的两个实际危害：父会话退出时按
// 身份回收整棵进程树（CLAUDE_CODE_SESSION_ID/CLAUDE_PID/MESSAGING_*）；
// 指向已死编辑器 IPC 的 askpass 会把非交互 git 调用挂起（GIT_ASKPASS/VSCODE_*）。
// ANTHROPIC_* 是 provider 凭据必须透传,不在此列。
const SESSION_SCOPED = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SSE_PORT",
  "GIT_ASKPASS",
  "VSCODE_GIT_ASKPASS_EXTRA_ARGS",
  "VSCODE_GIT_ASKPASS_MAIN",
  "VSCODE_GIT_ASKPASS_NODE",
  "VSCODE_GIT_IPC_AUTH_TOKEN",
  "VSCODE_GIT_IPC_HANDLE",
  "VSCODE_INJECTION",
  "VSCODE_PROFILE_INITIALIZED",
  "VSCODE_PYTHON_AUTOACTIVATE_GUARD",
];

export function scrubSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of SESSION_SCOPED) delete clean[key];
  return clean;
}
