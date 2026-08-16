import { beforeEach, describe, expect, it } from "vitest";
import {
  buildChangelogReleases,
  isChangelogUnread,
  lastSeenChangelogVersion,
  markChangelogSeen,
} from "./changelog";

const fixtureRaw = import.meta.glob<string>("./__fixtures__/changelog/*.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
});
const fixtureScreenshots = import.meta.glob<string>("./__fixtures__/changelog/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

describe("buildChangelogReleases", () => {
  it("聚合全部 yaml 并按版本号数值倒序（v2026.08.10 排在 v2026.08.9 前）", () => {
    const releases = buildChangelogReleases(fixtureRaw, fixtureScreenshots);

    expect(releases.map((r) => r.version)).toEqual(["v2026.08.10", "v2026.08.9"]);
    expect(releases[0]?.date).toBe("2026-08-16");
  });

  it("按版本号数值倒序，与输入顺序无关", () => {
    const yamlFor = (version: string) =>
      `version: ${version}\ndate: 2026-08-16\nentries:\n  - category: 修复\n    user: u\n    full: f\n`;
    const scrambled = {
      "/c/v2026.08.9.yaml": yamlFor("v2026.08.9"),
      "/c/v2026.08.10.yaml": yamlFor("v2026.08.10"),
    };

    const releases = buildChangelogReleases(scrambled, {});

    expect(releases.map((r) => r.version)).toEqual(["v2026.08.10", "v2026.08.9"]);
  });

  it("过滤 category=内部 的条目", () => {
    const releases = buildChangelogReleases(fixtureRaw, fixtureScreenshots);
    const v9 = releases.find((r) => r.version === "v2026.08.9");

    expect(v9?.entries).toHaveLength(1);
    expect(v9?.entries[0]?.category).toBe("修复");
    expect(v9?.entries.some((e) => e.user === "升级依赖")).toBe(false);
  });

  it("把版本同名目录下的 PNG 映射为 文件名 → URL", () => {
    const releases = buildChangelogReleases(fixtureRaw, fixtureScreenshots);
    const v10 = releases.find((r) => r.version === "v2026.08.10");
    const v9 = releases.find((r) => r.version === "v2026.08.9");

    expect(v10?.screenshots["shot.png"]).toContain("shot.png");
    expect(v9?.screenshots).toEqual({});
  });

  it("schema 不合规直接抛错（CI 校验之外的兜底）", () => {
    const bad = {
      "/anywhere/v2026.08.0.yaml": "version: v2026.08.0\ndate: not-a-date\nentries: []\n",
    };
    expect(() => buildChangelogReleases(bad, {})).toThrow();
  });

  it("没有任何 yaml 时返回空数组", () => {
    expect(buildChangelogReleases({}, {})).toEqual([]);
  });
});

describe("isChangelogUnread", () => {
  it("bundle 内无版本时永不显示红点", () => {
    expect(isChangelogUnread(null, null)).toBe(false);
  });

  it("从未看过（lastSeen 为空）时显示红点", () => {
    expect(isChangelogUnread("v2026.08.10", null)).toBe(true);
  });

  it("上次查看版本落后最新版本时显示红点", () => {
    expect(isChangelogUnread("v2026.08.10", "v2026.08.9")).toBe(true);
  });

  it("上次查看版本即最新版本时不显示红点", () => {
    expect(isChangelogUnread("v2026.08.10", "v2026.08.10")).toBe(false);
  });
});

describe("lastSeen 存储", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("markChangelogSeen 写入后 lastSeenChangelogVersion 读回同一版本", () => {
    expect(lastSeenChangelogVersion()).toBeNull();

    markChangelogSeen("v2026.08.10");

    expect(lastSeenChangelogVersion()).toBe("v2026.08.10");
  });
});
