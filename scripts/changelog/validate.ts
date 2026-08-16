import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { changelogFileSchema } from "@insuredesk/shared";
import { isNode, LineCounter, parseDocument } from "yaml";

export interface ChangelogError {
  file: string;
  line?: number;
  col?: number;
  message: string;
}

const FILENAME_PATTERN = /^v\d{4}\.\d{2}\.\d+\.yaml$/;

type Doc = ReturnType<typeof parseDocument>;

function formatPath(path: PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    out += typeof seg === "number" ? `[${seg}]` : out === "" ? String(seg) : `.${String(seg)}`;
  }
  return out;
}

function posOf(doc: Doc, lineCounter: LineCounter, path: PropertyKey[]) {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = doc.getIn(path.slice(0, depth), true);
    if (isNode(node) && node.range) {
      const { line, col } = lineCounter.linePos(node.range[0]);
      return { line, col };
    }
  }
  return {};
}

export function validateChangelogFile(file: string): ChangelogError[] {
  const errors: ChangelogError[] = [];
  const name = basename(file);
  if (!FILENAME_PATTERN.test(name)) {
    errors.push({ file, message: `文件名必须是 v<年>.<月>.<序号>.yaml，收到 ${name}` });
    return errors;
  }
  const version = name.slice(0, -".yaml".length);

  const lineCounter = new LineCounter();
  const doc = parseDocument(readFileSync(file, "utf8"), { lineCounter });
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const pos = err.linePos?.[0];
      errors.push({
        file,
        line: pos?.line,
        col: pos?.col,
        message: `YAML 语法错误: ${err.message}`,
      });
    }
    return errors;
  }

  let data: unknown;
  try {
    data = doc.toJS();
  } catch (err) {
    errors.push({ file, message: `YAML 解析失败: ${(err as Error).message}` });
    return errors;
  }

  const parsed = changelogFileSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        file,
        ...posOf(doc, lineCounter, issue.path),
        message: `${formatPath(issue.path) || "(根)"}: ${issue.message}`,
      });
    }
    return errors;
  }

  if (parsed.data.version !== version) {
    errors.push({
      file,
      ...posOf(doc, lineCounter, ["version"]),
      message: `version: 与文件名不一致（文件 ${version}，字段 ${parsed.data.version}）`,
    });
  }

  for (const [index, entry] of parsed.data.entries.entries()) {
    if (!entry.screenshot) continue;
    const png = join(dirname(file), version, entry.screenshot);
    if (!existsSync(png)) {
      errors.push({
        file,
        ...posOf(doc, lineCounter, ["entries", index, "screenshot"]),
        message: `entries[${index}].screenshot: 引用的 PNG 不存在 ${join(version, entry.screenshot)}`,
      });
    }
  }
  return errors;
}

function defaultFiles(): string[] {
  const dir = join(import.meta.dirname, "../../changelog");
  return readdirSync(dir)
    .filter((f) => FILENAME_PATTERN.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export function main(argv: string[]): number {
  const files = argv.length > 0 ? argv : defaultFiles();
  let count = 0;
  for (const file of files) {
    for (const e of validateChangelogFile(file)) {
      count++;
      console.error(`${e.file}:${e.line ?? 1}:${e.col ?? 1}: ${e.message}`);
    }
  }
  if (count > 0) {
    console.error(`changelog 校验失败：${count} 个错误`);
    return 1;
  }
  console.log(`changelog 校验通过（${files.length} 个文件）`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
