import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { touchSetsOverlap } from "./frontier.ts";

const nonEmptyLists = ["acceptanceCriteria", "outOfScope", "touchSet", "testPlan"];
const lists = [...nonEmptyLists, "logicalLocks", "dependsOn"];

function reaches(from, target, tickets, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (tickets.get(from)?.dependsOn ?? []).some((dependency) =>
    reaches(dependency, target, tickets, seen),
  );
}

export function validatePlan(plan) {
  if (!Array.isArray(plan?.tickets) || plan.tickets.length === 0) {
    return ["plan must contain tickets"];
  }
  const errors = [];
  const tickets = new Map();
  for (const ticket of plan.tickets) {
    if (typeof ticket.key !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(ticket.key)) {
      errors.push("ticket key must be lowercase kebab-case");
      continue;
    }
    if (tickets.has(ticket.key)) errors.push(`duplicate ticket key ${ticket.key}`);
    tickets.set(ticket.key, ticket);
    if (!ticket.title?.trim()) errors.push(`ticket ${ticket.key} needs title`);
    if (!ticket.goal?.trim()) errors.push(`ticket ${ticket.key} needs goal`);
    for (const field of lists) {
      if (!Array.isArray(ticket[field])) errors.push(`ticket ${ticket.key} needs ${field} array`);
      else if (ticket[field].some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`ticket ${ticket.key} needs string values in ${field}`);
      }
    }
    for (const field of nonEmptyLists) {
      if (Array.isArray(ticket[field]) && ticket[field].length === 0) {
        errors.push(`ticket ${ticket.key} needs non-empty ${field}`);
      }
    }
    if (typeof ticket.serialOnly !== "boolean")
      errors.push(`ticket ${ticket.key} needs serialOnly`);
  }
  for (const ticket of plan.tickets) {
    for (const dependency of ticket.dependsOn ?? []) {
      if (!tickets.has(dependency))
        errors.push(`ticket ${ticket.key} has unknown dependency ${dependency}`);
    }
  }
  if (
    plan.tickets.some((ticket) =>
      (ticket.dependsOn ?? []).some((dependency) => reaches(dependency, ticket.key, tickets)),
    )
  ) {
    errors.push("dependency graph contains a cycle");
  }
  for (let left = 0; left < plan.tickets.length; left += 1) {
    for (let right = left + 1; right < plan.tickets.length; right += 1) {
      const a = plan.tickets[left];
      const b = plan.tickets[right];
      if (!Array.isArray(a.touchSet) || !Array.isArray(b.touchSet)) continue;
      const lockOverlap = (a.logicalLocks ?? []).some((lock) =>
        (b.logicalLocks ?? []).includes(lock),
      );
      if (
        (touchSetsOverlap(a.touchSet, b.touchSet) || lockOverlap) &&
        !reaches(a.key, b.key, tickets) &&
        !reaches(b.key, a.key, tickets)
      ) {
        errors.push(`tickets ${a.key} and ${b.key} conflict without dependency ordering`);
      }
    }
  }
  return [...new Set(errors)];
}

function bullets(values, checklist = false, code = false) {
  return values
    .map((value) => `${checklist ? "- [ ]" : "-"} ${code ? `\`${value}\`` : value}`)
    .join("\n");
}

export function renderTickets(plan, parent, issueNumbers = {}) {
  return plan.tickets.map((ticket) => ({
    ...ticket,
    body: [
      `<!-- agent-plan:${parent}:${ticket.key} -->`,
      ...(parent ? [`Part of #${parent}.`, ""] : []),
      "## Goal",
      ticket.goal,
      "",
      "## Scope",
      "In scope:",
      bullets(ticket.touchSet, false, true),
      "",
      "Out of scope:",
      bullets(ticket.outOfScope),
      "",
      "## Declared touch-set",
      bullets(ticket.touchSet, false, true),
      "",
      "## Logical locks",
      ticket.logicalLocks.length > 0 ? bullets(ticket.logicalLocks, false, true) : "- None",
      "",
      "## Acceptance criteria",
      bullets(ticket.acceptanceCriteria, true),
      "",
      "## Test plan",
      bullets(ticket.testPlan),
      "",
      "## Dependencies",
      ticket.dependsOn.length > 0
        ? bullets(
            ticket.dependsOn.map((key) =>
              issueNumbers[key]
                ? `#${issueNumbers[key]} (plan key: \`${key}\`)`
                : `Plan key: \`${key}\` (resolved before queueing)`,
            ),
          )
        : "- None",
    ].join("\n"),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = JSON.parse(
    await new Promise((resolve) => {
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", () => resolve(input));
    }),
  );
  const errors = validatePlan(plan);
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else if (process.argv[2] === "render") {
    const issueNumbers = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : {};
    process.stdout.write(
      `${JSON.stringify(renderTickets(plan, Number(process.argv[3]), issueNumbers))}\n`,
    );
  }
}
