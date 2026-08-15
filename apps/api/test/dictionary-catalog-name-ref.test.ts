import { describe, expect, it } from "vitest";
import {
  buildCatalogNameIndex,
  resolveCatalogNameRef,
} from "../src/services/dictionary-catalog.service.ts";

/**
 * 目录按 NAME 的判定（导入的名字解析走这里）：ok / missing / disabled 三分支，
 * 与 resolveNewRef 同源约束——存在且启用——只是按名字、不抛异常，把措辞交回调用方。
 */
describe("resolveCatalogNameRef", () => {
  const index = buildCatalogNameIndex([
    { id: "ch-feishu", name: "飞书", active: true },
    { id: "ch-legacy", name: "老渠道", active: false },
  ]);

  it("ok：名字存在且启用，带出其 id", () => {
    expect(resolveCatalogNameRef(index, "飞书")).toEqual({ status: "ok", id: "ch-feishu" });
  });

  it("missing：名字不在目录", () => {
    expect(resolveCatalogNameRef(index, "查无此名")).toEqual({ status: "missing" });
  });

  it("disabled：名字存在但已停用——与 missing 分得开", () => {
    expect(resolveCatalogNameRef(index, "老渠道")).toEqual({ status: "disabled" });
  });
});
