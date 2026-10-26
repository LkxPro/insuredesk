// DataV 连续请求数百次会被限流（403）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mapshaperDir = process.argv[2];
if (!mapshaperDir) {
  console.error("用法：node scripts/region-maps/gen.mjs <mapshaper 安装目录>");
  process.exit(1);
}
const mapshaper = createRequire(join(mapshaperDir, "package.json"))("mapshaper");

const ROOT = new URL("../../", import.meta.url);
const REGION_OUT = new URL("apps/web/src/lib/region/", ROOT);
const DETAIL = 900;

const rowsText = readFileSync(new URL("packages/shared/src/region/region-data.ts", ROOT), "utf8");
const children = new Map();
const levels = new Map();
for (const line of rowsText.split("\n")) {
  const match = /^(\d{6}),[^,]*,(\d{6})?,([pcd])$/.exec(line.trim());
  if (!match) continue;
  const [, code, parent, level] = match;
  levels.set(code, level);
  if (parent) children.set(parent, [...(children.get(parent) ?? []), code]);
}

const targets = [
  ...[...levels].filter(([code, level]) => level === "p" && children.has(code)),
  ...[...levels].filter(([code, level]) => level === "c" && children.has(code)),
].map(([code, level]) => ({ code, dir: level === "p" ? "provinces" : "cities" }));

const downloadDir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "datav-"));
console.log(`下载目录：${downloadDir}，共 ${targets.length} 个区划`);
mkdirSync(new URL("cities/", REGION_OUT), { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(code) {
  const cached = join(downloadDir, `${code}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await sleep(300);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      writeFileSync(cached, text);
      return JSON.parse(text);
    } catch (error) {
      if (attempt >= 4) throw new Error(`${code} 下载失败：${error.message}`);
      await sleep(2000 * attempt);
    }
  }
}

function diagonalMeters(geoJson) {
  let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      minX = Math.min(minX, coords[0]);
      maxX = Math.max(maxX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxY = Math.max(maxY, coords[1]);
    } else coords.forEach(visit);
  };
  for (const feature of geoJson.features) visit(feature.geometry.coordinates);
  const dx = (maxX - minX) * 111_320 * Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const dy = (maxY - minY) * 110_574;
  return Math.hypot(dx, dy);
}

const problems = [];
let totalBytes = 0;
for (const [index, { code, dir }] of targets.entries()) {
  const source = await download(code);
  const expected = new Set(children.get(code));
  source.features = source.features.filter((feature) =>
    expected.has(String(feature.properties.adcode)),
  );
  const got = new Set(source.features.map((feature) => String(feature.properties.adcode)));
  const missing = [...expected].filter((child) => !got.has(child));
  if (missing.length > 0) problems.push(`${code} 缺 ${missing.join(" ")}`);

  const interval = Math.max(20, Math.round(diagonalMeters(source) / DETAIL));
  const precision = interval < 300 ? 0.0001 : 0.001;
  const output = await mapshaper.applyCommands(
    `-i in.json -filter-fields adcode,name -simplify interval=${interval} keep-shapes ` +
      `-o out.json format=geojson precision=${precision}`,
    { "in.json": JSON.stringify(source) },
  );
  const simplified = JSON.parse(output["out.json"]);
  const text = `{"type":"FeatureCollection","features":[\n${simplified.features
    .map((feature) => JSON.stringify(feature))
    .join(",\n")}\n]}\n`;
  writeFileSync(new URL(`${dir}/${code}.geo.json`, REGION_OUT), text);
  totalBytes += Buffer.byteLength(text);
  if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${targets.length}`);
}

console.log(`完成：${targets.length} 个文件，合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
if (problems.length > 0) console.log(`下级缺失：\n  ${problems.join("\n  ")}`);
