import { describe, expect, it } from "vitest";
import { CHANGELOG_CATEGORIES, changelogEntrySchema, changelogFileSchema } from "./changelog.ts";

const validEntry = {
  category: "新增",
  user: "工单列表支持按渠道筛选",
  full: "工单列表页新增渠道筛选器，支持多选与清空，筛选条件随导出生效。",
  page: "/tickets",
  screenshot: "tickets-filter.png",
};

const validFile = {
  version: "v2026.08.0",
  date: "2026-08-16",
  entries: [validEntry, { category: "内部", user: "升级依赖", full: "升级内部依赖版本。" }],
};

describe("changelogFileSchema", () => {
  it("接受完整合法文件（含可选 page/screenshot 与最小条目）", () => {
    const parsed = changelogFileSchema.parse(validFile);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.screenshot).toBe("tickets-filter.png");
    expect(parsed.entries[1]?.page).toBeUndefined();
  });

  it("version 必须是 CalVer v<年>.<月>.<序号>", () => {
    for (const version of ["2026.08.0", "v2026.8.0", "v2026.08", "V2026.08.0", "1.2.3"]) {
      const result = changelogFileSchema.safeParse({ ...validFile, version });
      expect(result.success, version).toBe(false);
    }
    for (const version of ["v2026.08.0", "v2026.12.3"]) {
      expect(changelogFileSchema.safeParse({ ...validFile, version }).success, version).toBe(true);
    }
  });

  it("date 必须是真实存在的 ISO 日期", () => {
    for (const date of ["2026-13-01", "2026-02-30", "2026/08/16", "昨天"]) {
      expect(changelogFileSchema.safeParse({ ...validFile, date }).success, date).toBe(false);
    }
  });

  it("entries 至少一条", () => {
    expect(changelogFileSchema.safeParse({ ...validFile, entries: [] }).success).toBe(false);
  });

  it("拒绝未知顶层字段", () => {
    expect(changelogFileSchema.safeParse({ ...validFile, extra: 1 }).success).toBe(false);
  });
});

describe("changelogEntrySchema", () => {
  it("category 只取四个分类字面量", () => {
    for (const category of CHANGELOG_CATEGORIES) {
      expect(changelogEntrySchema.safeParse({ ...validEntry, category }).success, category).toBe(
        true,
      );
    }
    for (const category of ["优化", "新增功能", "fix", ""]) {
      const result = changelogEntrySchema.safeParse({ ...validEntry, category });
      expect(result.success, category).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["category"]);
      }
    }
  });

  it("user/full 必填且不能是空白", () => {
    const { user: _user, ...noUser } = validEntry;
    expect(changelogEntrySchema.safeParse(noUser).success).toBe(false);
    expect(changelogEntrySchema.safeParse({ ...validEntry, user: "   " }).success).toBe(false);
    expect(changelogEntrySchema.safeParse({ ...validEntry, full: "" }).success).toBe(false);
  });

  it("screenshot 必须是裸 PNG 文件名", () => {
    for (const screenshot of ["shots/a.png", "a.jpg", "../a.png", "a.PNG ", "中文.png"]) {
      const result = changelogEntrySchema.safeParse({ ...validEntry, screenshot });
      expect(result.success, screenshot).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["screenshot"]);
      }
    }
  });

  it("page 必须是站内路由路径", () => {
    for (const page of ["tickets", "https://x.dev/t", ""]) {
      const result = changelogEntrySchema.safeParse({ ...validEntry, page });
      expect(result.success, page).toBe(false);
    }
  });
});
