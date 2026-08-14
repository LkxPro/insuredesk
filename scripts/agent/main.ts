import { join } from "node:path";
import {
  bootstrap,
  daemon,
  dispatchTick,
  queue,
  reconcileCi,
  transition,
  validateBody,
} from "./dispatch.ts";
import { netCall } from "./net.ts";
import { renderAll } from "./status.ts";
import { runWorker } from "./worker.ts";

const usage = `usage: main.ts {bootstrap|validate-body|transition|queue|dispatch|daemon|status|worker|reconcile-ci} [arg]`;

async function repoRoot(): Promise<string> {
  return (await netCall("git", ["rev-parse", "--show-toplevel"])).trim();
}

const [command, arg] = process.argv.slice(2);

switch (command) {
  case "bootstrap":
    await bootstrap();
    break;
  case "validate-body": {
    let body = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) body += chunk;
    const error = validateBody(body);
    if (error !== null) {
      process.stderr.write(`${error}\n`);
      process.exit(1);
    }
    break;
  }
  case "transition": {
    if (!arg) throw new Error("issue number required");
    await transition(Number.parseInt(arg, 10));
    break;
  }
  case "queue": {
    const maxParallel = Number.parseInt(process.env.AGENT_LOOP_MAX_PARALLEL ?? "4", 10) || 4;
    const plan = await queue(maxParallel);
    for (const skipped of plan.skipped)
      process.stderr.write(`skip #${skipped.number}: ${skipped.reason}\n`);
    for (const selected of plan.selected) process.stdout.write(`${selected}\n`);
    break;
  }
  case "dispatch":
    await dispatchTick(await repoRoot());
    break;
  case "daemon":
    await daemon(await repoRoot());
    break;
  case "status": {
    const root = await repoRoot();
    const worktrees = process.env.AGENT_LOOP_WORKTREES ?? join(root, ".worktrees");
    if (arg === "--watch") {
      for (;;) {
        process.stdout.write("\x1b[2J\x1b[H");
        process.stdout.write(`${new Date().toLocaleTimeString()}\n`);
        process.stdout.write(await renderAll(worktrees));
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } else {
      process.stdout.write(await renderAll(worktrees));
    }
    break;
  }
  case "worker": {
    const issue = Number.parseInt(arg ?? "", 10);
    const worktree = process.argv[4];
    if (!Number.isInteger(issue) || !worktree) throw new Error("worker <issue> <worktree>");
    const root = await repoRoot();
    process.exitCode = await runWorker(root, worktree, issue);
    break;
  }
  case "reconcile-ci": {
    if (!arg) throw new Error("branch required");
    await reconcileCi(arg);
    break;
  }
  default:
    process.stderr.write(`${usage}\n`);
    process.exit(64);
}
