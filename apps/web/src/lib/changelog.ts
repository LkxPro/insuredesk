import {
  type ChangelogCategory,
  type ChangelogEntry,
  changelogFileSchema,
} from "@insuredesk/shared";
import { parse } from "yaml";

/** changelog yaml 在仓库根 changelog/ 随版本提交，schema 合规由 CI 校验器保证。 */

export type VisibleChangelogEntry = ChangelogEntry & {
  category: Exclude<ChangelogCategory, "内部">;
};

export interface ChangelogRelease {
  version: string;
  date: string;
  entries: VisibleChangelogEntry[];
  /** 截图文件名 → 打包后的资源 URL */
  screenshots: Record<string, string>;
}

/** CalVer 序号段不补零（v2026.08.10 > v2026.08.9）。 */
function compareVersionsDesc(a: string, b: string): number {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < pa.length; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function buildChangelogReleases(
  rawByPath: Record<string, string>,
  screenshotUrlByPath: Record<string, string>,
): ChangelogRelease[] {
  return Object.entries(rawByPath)
    .map(([yamlPath, raw]) => {
      const file = changelogFileSchema.parse(parse(raw));
      const yamlDir = yamlPath.slice(0, yamlPath.lastIndexOf("/"));
      const screenshotPrefix = `${yamlDir}/${file.version}/`;
      const screenshots: Record<string, string> = {};
      for (const [path, url] of Object.entries(screenshotUrlByPath)) {
        if (path.startsWith(screenshotPrefix)) {
          screenshots[path.slice(screenshotPrefix.length)] = url;
        }
      }
      return {
        version: file.version,
        date: file.date,
        entries: file.entries.filter(
          (entry): entry is VisibleChangelogEntry => entry.category !== "内部",
        ),
        screenshots,
      };
    })
    .sort((a, b) => compareVersionsDesc(a.version, b.version));
}

const rawByPath = import.meta.glob<string>("../../../../changelog/*.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
});
const screenshotUrlByPath = import.meta.glob<string>("../../../../changelog/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export const changelogReleases: ChangelogRelease[] = buildChangelogReleases(
  rawByPath,
  screenshotUrlByPath,
);
export const latestChangelogVersion: string | null = changelogReleases[0]?.version ?? null;

const LAST_SEEN_KEY = "insuredesk-changelog-seen";
const SEEN_EVENT = "insuredesk:changelog-seen";

export function lastSeenChangelogVersion(): string | null {
  return window.localStorage.getItem(LAST_SEEN_KEY);
}

export function markChangelogSeen(version: string): void {
  window.localStorage.setItem(LAST_SEEN_KEY, version);
  window.dispatchEvent(new Event(SEEN_EVENT));
}

export function onChangelogSeen(listener: () => void): () => void {
  window.addEventListener(SEEN_EVENT, listener);
  return () => window.removeEventListener(SEEN_EVENT, listener);
}

export function isChangelogUnread(latest: string | null, lastSeen: string | null): boolean {
  return latest !== null && latest !== lastSeen;
}
