import { describe, expect, it } from "vitest";
import { allocateSheetNames } from "../src/services/export-file.ts";

describe("allocateSheetNames", () => {
  it("空数组原样返回", () => {
    expect(allocateSheetNames([])).toEqual([]);
  });

  it("原名合法时不改动", () => {
    expect(allocateSheetNames(["投诉", "退费异常"])).toEqual(["投诉", "退费异常"]);
  });

  it("剥离非法字符与首尾单引号，保留名 History 走 fallback", () => {
    expect(allocateSheetNames(["a/b*c", "'报表'", "History", "history"])).toEqual([
      "abc",
      "报表",
      "Sheet3",
      "Sheet4",
    ]);
  });

  it("空消毒结果撞 fallback、自然名大小写撞车均加后缀", () => {
    expect(allocateSheetNames(["Sheet2", "///", "abc", "ABC"])).toEqual([
      "Sheet2",
      "Sheet2 (2)",
      "abc",
      "ABC (2)",
    ]);
  });

  it("连续碰撞递增后缀", () => {
    expect(allocateSheetNames(["x", "x", "x"])).toEqual(["x", "x (2)", "x (3)"]);
  });

  it("31 字符上限：超长截断，撞名加后缀后仍不超 31", () => {
    const long = "类".repeat(40);
    const [first, second] = allocateSheetNames([long, long]);
    expect(first).toBe("类".repeat(31));
    expect(second).toBe(`${"类".repeat(27)} (2)`);
    expect(second).toHaveLength(31);
  });
});
