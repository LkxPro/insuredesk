import { describe, expect, it } from "vitest";
import {
  createdRangeLabel,
  localDatesToCreatedRange,
  matchCreatedRangePreset,
  presetToCreatedRange,
} from "./created-range";

/**
 * 断言全部用本地时刻构造期望值（预设按浏览器时区算日界），所以测试不绑定
 * 运行环境的时区。
 */

function customRange(from: string, to: string) {
  const range = localDatesToCreatedRange(from, to);
  if (!range) {
    throw new Error(`fixture 区间无效: ${from} ~ ${to}`);
  }
  return range;
}

function localStart(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}
function localEnd(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

// 2026-07-15 是周三，便于区分 本周(周一起) / 本月 / 近 7 天
const wednesday = new Date(2026, 6, 15, 10, 30, 0, 0);

describe("presetToCreatedRange", () => {
  it("本日 = 当地当天 00:00:00.000 到 23:59:59.999", () => {
    expect(presetToCreatedRange("today", wednesday)).toEqual({
      createdFrom: localStart(2026, 7, 15),
      createdTo: localEnd(2026, 7, 15),
    });
  });

  it("本周自周一起算，到周日结束", () => {
    expect(presetToCreatedRange("thisWeek", wednesday)).toEqual({
      createdFrom: localStart(2026, 7, 13),
      createdTo: localEnd(2026, 7, 19),
    });
  });

  it("本月取整月", () => {
    expect(presetToCreatedRange("thisMonth", wednesday)).toEqual({
      createdFrom: localStart(2026, 7, 1),
      createdTo: localEnd(2026, 7, 31),
    });
  });

  it("近 7 天 / 近 30 天含今天，各为 7 / 30 个整日", () => {
    expect(presetToCreatedRange("last7Days", wednesday)).toEqual({
      createdFrom: localStart(2026, 7, 9),
      createdTo: localEnd(2026, 7, 15),
    });
    expect(presetToCreatedRange("last30Days", wednesday)).toEqual({
      createdFrom: localStart(2026, 6, 16),
      createdTo: localEnd(2026, 7, 15),
    });
  });

  it("跨月跨年的近 30 天照样按日历天回退", () => {
    expect(presetToCreatedRange("last30Days", new Date(2026, 0, 5, 8, 0, 0, 0))).toEqual({
      createdFrom: localStart(2025, 12, 7),
      createdTo: localEnd(2026, 1, 5),
    });
  });
});

describe("localDatesToCreatedRange", () => {
  it("自定义起止日期同样撑满两端日界", () => {
    expect(localDatesToCreatedRange("2026-07-06", "2026-07-12")).toEqual({
      createdFrom: localStart(2026, 7, 6),
      createdTo: localEnd(2026, 7, 12),
    });
  });

  it("同一天的自定义区间 = 该日整天", () => {
    expect(localDatesToCreatedRange("2026-07-06", "2026-07-06")).toEqual({
      createdFrom: localStart(2026, 7, 6),
      createdTo: localEnd(2026, 7, 6),
    });
  });

  it("残缺或非法日期换不出区间", () => {
    expect(localDatesToCreatedRange("2026-07", "2026-07-12")).toBeNull();
    expect(localDatesToCreatedRange("2026-02-30", "2026-07-12")).toBeNull();
    expect(localDatesToCreatedRange("", "")).toBeNull();
  });
});

describe("matchCreatedRangePreset", () => {
  it("恰好等于某预设边界时反查出该预设", () => {
    for (const preset of ["today", "thisWeek", "thisMonth", "last7Days", "last30Days"] as const) {
      expect(matchCreatedRangePreset(presetToCreatedRange(preset, wednesday), wednesday)).toBe(
        preset,
      );
    }
  });

  it("偏离预设边界一毫秒即算自定义", () => {
    const today = presetToCreatedRange("today", wednesday);
    expect(
      matchCreatedRangePreset(
        { ...today, createdTo: new Date(new Date(today.createdTo).getTime() - 1).toISOString() },
        wednesday,
      ),
    ).toBeNull();
  });

  it("单边区间不匹配任何预设——预设两端都定死", () => {
    const today = presetToCreatedRange("today", wednesday);
    expect(matchCreatedRangePreset({ createdFrom: today.createdFrom }, wednesday)).toBeNull();
    expect(matchCreatedRangePreset({ createdTo: today.createdTo }, wednesday)).toBeNull();
    expect(matchCreatedRangePreset({}, wednesday)).toBeNull();
  });

  it("同一区间同时符合多个预设时，取列表靠前者（周日的本周 = 近 7 天）", () => {
    const sunday = new Date(2026, 6, 19, 9, 0, 0, 0);
    expect(presetToCreatedRange("thisWeek", sunday)).toEqual(
      presetToCreatedRange("last7Days", sunday),
    );
    expect(matchCreatedRangePreset(presetToCreatedRange("last7Days", sunday), sunday)).toBe(
      "thisWeek",
    );
  });
});

describe("createdRangeLabel", () => {
  it("无区间显示全部，预设显示预设名", () => {
    expect(createdRangeLabel({}, wednesday)).toBe("全部");
    expect(createdRangeLabel(presetToCreatedRange("thisMonth", wednesday), wednesday)).toBe("本月");
  });

  it("非预设区间显示自定义 MM-DD ~ MM-DD", () => {
    expect(createdRangeLabel(customRange("2026-07-06", "2026-07-12"))).toBe("自定义 07-06 ~ 07-12");
  });

  it("单边区间也有可读回显", () => {
    const range = customRange("2026-07-06", "2026-07-12");
    expect(createdRangeLabel({ createdFrom: range.createdFrom })).toBe("自定义 07-06 起");
    expect(createdRangeLabel({ createdTo: range.createdTo })).toBe("自定义 07-12 止");
  });
});
