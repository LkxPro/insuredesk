import { describe, expect, it } from "vitest";
import { matchName, type NameMatch, splitSegments } from "./name-match";

const ZHANG_WEI = ["zhang", "wei"];
const LI_XINYI = ["li", "xin", "yi"];

function must(match: NameMatch | null): NameMatch {
  if (!match) {
    throw new Error("expected a match");
  }
  return match;
}

describe("splitSegments", () => {
  it("按空白分词,词内再拆中文/拉丁段", () => {
    expect(splitSegments("李 xin")).toEqual([
      { kind: "cjk", text: "李" },
      { kind: "latin", text: "xin" },
    ]);
    expect(splitSegments("张w")).toEqual([
      { kind: "cjk", text: "张" },
      { kind: "latin", text: "w" },
    ]);
    expect(splitSegments("")).toEqual([]);
  });
});

describe("matchName", () => {
  it("空查询匹配一切,分数为 0 且无高亮区间", () => {
    expect(matchName("张伟", ZHANG_WEI, "")).toEqual({ score: 0, ranges: [] });
  });

  it("中文子串命中并给出字面区间", () => {
    expect(matchName("张伟", ZHANG_WEI, "伟")).toEqual({ score: 94, ranges: [[1, 2]] });
    expect(matchName("张伟", ZHANG_WEI, "大")).toBeNull();
  });

  it("全拼前缀命中首字", () => {
    expect(matchName("张伟", ZHANG_WEI, "zhang")).toEqual({ score: 70, ranges: [[0, 1]] });
  });

  it("跨字全拼连打,末字允许部分音节", () => {
    expect(matchName("张伟", ZHANG_WEI, "zhangwei")?.ranges).toEqual([[0, 2]]);
    expect(matchName("张伟", ZHANG_WEI, "zhangw")?.ranges).toEqual([[0, 2]]);
    expect(matchName("李欣怡", LI_XINYI, "xiny")?.ranges).toEqual([[1, 3]]);
  });

  it("首字母连打", () => {
    expect(must(matchName("张伟", ZHANG_WEI, "zw")).ranges).toEqual([[0, 2]]);
  });

  it("全拼分数高于首字母,zhang 排在 zw 前面", () => {
    expect(must(matchName("张伟", ZHANG_WEI, "zhang")).score).toBeGreaterThan(
      must(matchName("张伟", ZHANG_WEI, "zw")).score,
    );
  });

  it("首字母必须逐字连续,不允许跳字;部分音节仍走全拼路径", () => {
    expect(matchName("赵文豪", ["zhao", "wen", "hao"], "zhw")).toBeNull();
    expect(matchName("赵文豪", ["zhao", "wen", "hao"], "zwh")?.ranges).toEqual([[0, 3]]);
    expect(matchName("赵文豪", ["zhao", "wen", "hao"], "zh")?.ranges).toEqual([[0, 1]]);
  });

  it("多段取交集,区间合并排序", () => {
    const hit = matchName("李欣怡", LI_XINYI, "李 xin");
    expect(hit?.ranges).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(matchName("李欣怡", LI_XINYI, "李 zhang")).toBeNull();
  });

  it("起始位置越靠后分数越低", () => {
    const first = must(matchName("张伟", ZHANG_WEI, "zhang")).score;
    const second = must(matchName("李张", ["li", "zhang"], "zhang")).score;
    expect(first).toBeGreaterThan(second);
  });
});
