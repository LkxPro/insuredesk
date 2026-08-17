import { readFileSync } from "node:fs";
import { callGh, NetCallError } from "./net.ts";

const usage =
  "usage: net-cli.ts [--attempts N] [--timeout-seconds N] [--base-delay-seconds N] -- [gh-args...]";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

const policy: { attempts: number; timeoutSeconds?: number; baseDelaySeconds?: number } = {
  attempts: 1,
};

const argv = process.argv.slice(2);
let i = 0;
const flagValue = (flag: string): number => {
  i += 1;
  const raw = argv[i];
  if (raw === undefined || !/^[0-9]+$/.test(raw) || Number.parseInt(raw, 10) <= 0)
    fail(`${flag} must be a positive integer`);
  return Number.parseInt(raw, 10);
};
while (i < argv.length && argv[i] !== "--") {
  const flag = argv[i] as string;
  if (flag === "--attempts") policy.attempts = flagValue(flag);
  else if (flag === "--timeout-seconds") policy.timeoutSeconds = flagValue(flag);
  else if (flag === "--base-delay-seconds") policy.baseDelaySeconds = flagValue(flag);
  else fail(`${usage}\nunknown flag: ${flag}`);
  i += 1;
}
if (argv[i] !== "--") fail(usage);
const args = argv.slice(i + 1);

// gh 的 --input - 约定请求体走 stdin。
let stdin: string | undefined;
if (args.some((arg, index) => arg === "--input" && args[index + 1] === "-"))
  stdin = readFileSync(0, "utf8");

try {
  process.stdout.write(await callGh(args, stdin, policy));
} catch (error) {
  if (error instanceof NetCallError) process.exit(error.status);
  throw error;
}
