import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CHANGELOG_CATEGORIES, type ChangelogFile, changelogFileSchema } from "@insuredesk/shared";
import { parse } from "yaml";
import { validateChangelogFile } from "../changelog/validate.ts";

export function renderNotes(file: ChangelogFile): string {
  const sections: string[] = [];
  for (const category of CHANGELOG_CATEGORIES) {
    const bullets = file.entries.filter((e) => e.category === category);
    if (bullets.length === 0) continue;
    sections.push(`## ${category}\n\n${bullets.map((e) => `- ${e.full}`).join("\n")}\n`);
  }
  return sections.join("\n");
}

export function main(argv: string[]): number {
  const [yamlArg] = argv;
  if (!yamlArg) {
    console.error("用法：node scripts/release/render-notes.ts <changelog/v<版本>.yaml>");
    return 1;
  }
  const yamlPath = resolve(yamlArg);
  if (!existsSync(yamlPath)) {
    console.error(
      `changelog 不存在：${yamlArg}（先 make release-prepare 起草并合并 changelog PR）`,
    );
    return 1;
  }

  const errors = validateChangelogFile(yamlPath);
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`${e.file}:${e.line ?? 1}:${e.col ?? 1}: ${e.message}`);
    }
    console.error(`changelog 校验失败：${errors.length} 个错误`);
    return 1;
  }

  const file = changelogFileSchema.parse(parse(readFileSync(yamlPath, "utf8")));
  process.stdout.write(renderNotes(file));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
