import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// web bundle 靠 import.meta.glob 在构建期内联仓库根 changelog/ 的 yaml 与截图;
// 该目录缺席时 glob 静默为空(构建不报错),生产 /changelog 变空页、红点不亮。
// CI 的 docker 构建校验只验证能构建,挡不住内容缺失,故在此钉住 COPY 的存在与先后。
const dockerfile = readFileSync(
  join(import.meta.dirname, "../../apps/api/Dockerfile"),
  "utf8",
).split("\n");

test("Dockerfile build 阶段在打 web bundle 前 COPY 仓库根 changelog/", () => {
  const copyIdx = dockerfile.findIndex((line) => /^COPY changelog \.\/changelog/.test(line));
  const webBuildIdx = dockerfile.findIndex((line) =>
    line.includes("--filter @insuredesk/web run build"),
  );
  assert.notEqual(webBuildIdx, -1, "未找到 web bundle 构建行");
  assert.notEqual(copyIdx, -1, "缺少 COPY changelog ./changelog");
  assert.ok(copyIdx < webBuildIdx, "COPY changelog 必须早于 web bundle 构建");
});
