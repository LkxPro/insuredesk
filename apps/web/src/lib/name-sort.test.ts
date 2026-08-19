import { describe, expect, it } from "vitest";
import { compareByName, sortByName } from "./name-sort";

describe("compareByName", () => {
  it("按拼音升序比较中文名", () => {
    expect(compareByName("保司", "回访问题")).toBeLessThan(0);
    expect(compareByName("回访问题", "理赔投诉")).toBeLessThan(0);
    expect(compareByName("理赔投诉", "保司")).toBeGreaterThan(0);
  });

  it("数字与字母按码位排在中文拼音之前", () => {
    expect(compareByName("400热线", "保司")).toBeLessThan(0);
  });

  it("拼音相同回退到字符本身比较", () => {
    expect(compareByName("保司", "保司")).toBe(0);
  });
});

describe("sortByName", () => {
  const rows = [{ name: "理赔投诉" }, { name: "保司" }, { name: "回访问题" }];

  it("asc 返回拼音升序的新数组，不改原数组", () => {
    const sorted = sortByName(rows, "asc");
    expect(sorted.map((row) => row.name)).toEqual(["保司", "回访问题", "理赔投诉"]);
    expect(rows.map((row) => row.name)).toEqual(["理赔投诉", "保司", "回访问题"]);
  });

  it("desc 为升序的镜像", () => {
    expect(sortByName(rows, "desc").map((row) => row.name)).toEqual([
      "理赔投诉",
      "回访问题",
      "保司",
    ]);
  });
});
