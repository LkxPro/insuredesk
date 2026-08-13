import { pathToFileURL } from "node:url";
import { normalizeIssue } from "./frontier.mjs";

function matcher(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") source += "[^/]*";
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function outsideTouchSet(patterns, files) {
  const matchers = patterns.map((pattern) => matcher(pattern.replace(/^\.\//, "")));
  return files.filter((file) => !matchers.some((candidate) => candidate.test(file)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const [issueLine, ...files] = input.split("\n").filter(Boolean);
  const issue = normalizeIssue(JSON.parse(issueLine));
  const outside = outsideTouchSet(issue.touchSet, files);
  if (outside.length > 0) {
    process.stderr.write(`changed files outside declared touch-set:\n${outside.join("\n")}\n`);
    process.exitCode = 1;
  }
}
