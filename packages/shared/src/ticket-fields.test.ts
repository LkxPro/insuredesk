import { describe, expect, it } from "vitest";
import { applyNoPolicyNumber, joinPolicyNumbers, splitPolicyNumbers } from "./ticket-fields.ts";

describe("applyNoPolicyNumber", () => {
  it("flag=true ⇒ 数组清空（与值同传时 flag 优先）", () => {
    expect(applyNoPolicyNumber({ noPolicyNumber: true, policyNumbers: ["P1", "P2"] })).toEqual({
      noPolicyNumber: true,
      policyNumbers: [],
    });
  });

  it("flag=false ⇒ 原样保留", () => {
    expect(applyNoPolicyNumber({ noPolicyNumber: false, policyNumbers: ["P1"] })).toEqual({
      noPolicyNumber: false,
      policyNumbers: ["P1"],
    });
  });
});

describe("splitPolicyNumbers", () => {
  it("空白分隔：空格/换行/制表符", () => {
    expect(splitPolicyNumbers("PA1  PB2\nPC3\tPD4")).toEqual(["PA1", "PB2", "PC3", "PD4"]);
  });

  it("标点分隔：逗号/顿号/分号/中文标点/竖线", () => {
    expect(splitPolicyNumbers("PA1,PB2、PC3；PD4，PE5｜PF6")).toEqual([
      "PA1",
      "PB2",
      "PC3",
      "PD4",
      "PE5",
      "PF6",
    ]);
  });

  it("混合分隔符与缠绕的空段都被吃掉", () => {
    expect(splitPolicyNumbers("  PA1、、  ，PB2,,")).toEqual(["PA1", "PB2"]);
  });

  it("连字符等非字母数字同样是分隔符", () => {
    expect(splitPolicyNumbers("P-2026-001")).toEqual(["P", "2026", "001"]);
  });

  it("去重（大小写敏感）并保留首次出现顺序", () => {
    expect(splitPolicyNumbers("PA1 pa1 PA1")).toEqual(["PA1", "pa1"]);
  });

  it("空串/全分隔符 → 空数组", () => {
    expect(splitPolicyNumbers("")).toEqual([]);
    expect(splitPolicyNumbers(" 、，\n ")).toEqual([]);
  });

  it("join 后无损 split 回同一数组", () => {
    const values = splitPolicyNumbers("PA1，PB2、PC3");
    expect(splitPolicyNumbers(joinPolicyNumbers(values))).toEqual(values);
  });
});
