import { describe, expect, it } from "vitest";
import { matchName, type NameMatch } from "./name-match";

function must(match: NameMatch | null): NameMatch {
  if (!match) {
    throw new Error("expected a match");
  }
  return match;
}

describe("matchName", () => {
  it("空查询匹配一切且无高亮区间", () => {
    expect(matchName("张伟", "")).toEqual({ ranges: [] });
  });

  it("中文子串命中并给出字面区间", () => {
    expect(matchName("张伟", "伟")?.ranges).toEqual([[1, 2]]);
    expect(matchName("张伟", "大")).toBeNull();
  });

  it("数字串按字面命中", () => {
    expect(matchName("12378热线", "12378")?.ranges).toEqual([[0, 5]]);
  });

  it("全拼与连打,末字允许部分音节", () => {
    expect(matchName("张伟", "zhang")?.ranges).toEqual([[0, 1]]);
    expect(matchName("张伟", "zhangwei")?.ranges).toEqual([[0, 2]]);
    expect(matchName("张伟", "zhangw")?.ranges).toEqual([[0, 2]]);
    expect(matchName("李欣怡", "xiny")?.ranges).toEqual([[1, 3]]);
  });

  it("首字母连打", () => {
    expect(must(matchName("张伟", "zw")).ranges).toEqual([[0, 2]]);
  });

  it("首字母允许跳字,命中区间按字拆开", () => {
    expect(matchName("重庆火锅", "qg")?.ranges).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(matchName("赵文豪", "zhw")).toBeNull();
    expect(matchName("赵文豪", "zwh")?.ranges).toEqual([[0, 3]]);
  });

  it("中拼混合", () => {
    expect(matchName("重庆火锅", "chong庆")?.ranges).toEqual([[0, 2]]);
  });

  describe("多音字", () => {
    it("姓氏多音字两个读音都命中", () => {
      expect(matchName("曾伟", "zengwei")?.ranges).toEqual([[0, 2]]);
      expect(matchName("曾伟", "cengwei")?.ranges).toEqual([[0, 2]]);
      expect(matchName("曾伟", "zw")).not.toBeNull();
      expect(matchName("曾伟", "cw")).not.toBeNull();
      expect(matchName("解良", "jieliang")).not.toBeNull();
      expect(matchName("解良", "xieliang")).not.toBeNull();
    });

    it("非首字多音字按任一读音命中", () => {
      expect(matchName("重庆", "chongqing")?.ranges).toEqual([[0, 2]]);
      expect(matchName("重庆", "zhongqing")?.ranges).toEqual([[0, 2]]);
      expect(matchName("中国银行", "zhonghang")).not.toBeNull();
      expect(matchName("中国银行", "zhongxing")).not.toBeNull();
      expect(matchName("乐乐", "yuele")).not.toBeNull();
    });
  });

  describe("空格分词", () => {
    it("多段取交集,与顺序无关", () => {
      expect(matchName("曾伟", "wei zeng")?.ranges).toEqual([[0, 2]]);
      expect(matchName("投诉信息接收渠道", "接收 投诉")?.ranges).toEqual([
        [0, 2],
        [4, 6],
      ]);
    });

    it("任一段不中则整体不中", () => {
      expect(matchName("李欣怡", "李 zhang")).toBeNull();
    });

    it("多段命中同一字时区间去重合并", () => {
      expect(matchName("曾伟", "zeng 曾")?.ranges).toEqual([[0, 1]]);
    });
  });
});
