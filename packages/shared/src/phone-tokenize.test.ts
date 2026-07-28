import { describe, expect, it } from "vitest";
import { tokenizePhone } from "./phone-tokenize";

describe("tokenizePhone", () => {
  describe("单号带分隔符", () => {
    it("提取带空格的手机号", () => {
      expect(tokenizePhone("138 0013 8000")).toEqual(["13800138000"]);
    });

    it("提取带横线的手机号", () => {
      expect(tokenizePhone("138-0013-8000")).toEqual(["13800138000"]);
    });

    it("提取带括号的区号座机", () => {
      expect(tokenizePhone("(010)12345678")).toEqual(["01012345678"]);
    });

    it("提取混合分隔符", () => {
      expect(tokenizePhone("138 0013-8000")).toEqual(["13800138000"]);
    });
  });

  describe("一格多号", () => {
    it("逗号分隔多个手机号", () => {
      expect(tokenizePhone("13800138000,13900139000")).toEqual(["13800138000", "13900139000"]);
    });

    it("顿号分隔多个手机号", () => {
      expect(tokenizePhone("13800138000、13900139000")).toEqual(["13800138000", "13900139000"]);
    });

    it("分号分隔多个手机号", () => {
      expect(tokenizePhone("13800138000;13900139000")).toEqual(["13800138000", "13900139000"]);
    });

    it("混合分隔符多号", () => {
      expect(tokenizePhone("138-0013-8000,139 0013 9000")).toEqual(["13800138000", "13900139000"]);
    });
  });

  describe("带备注字", () => {
    it("过滤尾部文字备注", () => {
      expect(tokenizePhone("13800138000王经理")).toEqual(["13800138000"]);
    });

    it("过滤前缀文字备注", () => {
      expect(tokenizePhone("座机：01012345678")).toEqual(["01012345678"]);
    });

    it("过滤中间文字备注", () => {
      expect(tokenizePhone("13800138000或13900139000")).toEqual(["13800138000", "13900139000"]);
    });

    it("多号带备注", () => {
      expect(tokenizePhone("手机13800138000，座机01012345678")).toEqual([
        "13800138000",
        "01012345678",
      ]);
    });
  });

  describe("座机带分机", () => {
    it("过滤短分机号", () => {
      expect(tokenizePhone("010-12345678-123")).toEqual(["01012345678"]);
    });

    it("过滤更短分机号", () => {
      expect(tokenizePhone("12345678转8")).toEqual(["12345678"]);
    });

    it("6位分机号被过滤", () => {
      expect(tokenizePhone("12345678-123456")).toEqual(["12345678"]);
    });
  });

  describe("纯文字", () => {
    it("无", () => {
      expect(tokenizePhone("无")).toEqual([]);
    });

    it("同上", () => {
      expect(tokenizePhone("同上")).toEqual([]);
    });

    it("未知", () => {
      expect(tokenizePhone("未知")).toEqual([]);
    });

    it("暂无联系方式", () => {
      expect(tokenizePhone("暂无联系方式")).toEqual([]);
    });
  });

  describe("空值处理", () => {
    it("null 返回空数组", () => {
      expect(tokenizePhone(null)).toEqual([]);
    });

    it("undefined 返回空数组", () => {
      expect(tokenizePhone(undefined)).toEqual([]);
    });

    it("空字符串返回空数组", () => {
      expect(tokenizePhone("")).toEqual([]);
    });

    it("纯空格返回空数组", () => {
      expect(tokenizePhone("   ")).toEqual([]);
    });
  });

  describe("<7位短数字", () => {
    it("6位数字被过滤", () => {
      expect(tokenizePhone("123456")).toEqual([]);
    });

    it("单个数字被过滤", () => {
      expect(tokenizePhone("8")).toEqual([]);
    });

    it("短号码组合全被过滤", () => {
      expect(tokenizePhone("123-456")).toEqual([]);
    });

    it("7位数字保留", () => {
      expect(tokenizePhone("1234567")).toEqual(["1234567"]);
    });
  });

  describe("真实场景", () => {
    it("标准11位手机号", () => {
      expect(tokenizePhone("13800138000")).toEqual(["13800138000"]);
    });

    it("区号+8位座机", () => {
      expect(tokenizePhone("010-12345678")).toEqual(["01012345678"]);
    });

    it("400电话", () => {
      expect(tokenizePhone("400-123-4567")).toEqual(["4001234567"]);
    });

    it("混合多种格式", () => {
      expect(tokenizePhone("手机：138 0013 8000，座机：(010)1234-5678转123")).toEqual([
        "13800138000",
        "01012345678",
      ]);
    });
  });
});
