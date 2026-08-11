import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type DetailNav,
  detailNav,
  detailNavStep,
  handleDetailArrowKey,
  pageBounds,
} from "./detail-navigation";

/**
 * 跨页翻单契约（issue #186）：↑/↓/←/→ 与 prev/next 按钮共用同一个 step 解析——
 * 切片内有邻居就换单，越界且有页可翻就翻页（落地选边界单），否则死停。
 * 这里钉住纯逻辑；页面级行为（URL 页码同步、落地选中）走页面测试。
 */

function nav(overrides: Partial<DetailNav> = {}): DetailNav {
  return {
    prev: null,
    next: null,
    inSlice: true,
    hasPrevPage: false,
    hasNextPage: false,
    ...overrides,
  };
}

describe("detailNav", () => {
  const items = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  const onePage = { page: 1, pageSize: 20, total: 3 };

  it("切片首尾给邻居，中间两个方向都有", () => {
    expect(detailNav(items, "t1", onePage)).toMatchObject({ prev: null, next: "t2" });
    expect(detailNav(items, "t2", onePage)).toMatchObject({ prev: "t1", next: "t3" });
    expect(detailNav(items, "t3", onePage)).toMatchObject({ prev: "t2", next: null });
  });

  it("选中单不在切片里：无邻居且 inSlice=false（深链到别的页）", () => {
    expect(detailNav(items, "t9", onePage)).toMatchObject({
      prev: null,
      next: null,
      inSlice: false,
    });
  });
});

describe("pageBounds", () => {
  it("唯一一页：两个方向都翻不出去", () => {
    expect(pageBounds({ page: 1, pageSize: 50, total: 50 })).toEqual({
      hasPrevPage: false,
      hasNextPage: false,
    });
  });

  it("首页有下一页，末页无下一页；page*pageSize 恰好等于 total 即末页", () => {
    expect(pageBounds({ page: 1, pageSize: 50, total: 51 }).hasNextPage).toBe(true);
    expect(pageBounds({ page: 2, pageSize: 50, total: 51 })).toEqual({
      hasPrevPage: true,
      hasNextPage: false,
    });
    expect(pageBounds({ page: 2, pageSize: 50, total: 100 }).hasNextPage).toBe(false);
  });
});

describe("detailNavStep", () => {
  it("切片内有邻居：换单", () => {
    expect(detailNavStep("prev", nav({ prev: "t1" }))).toEqual({
      kind: "switch",
      ticketId: "t1",
    });
    expect(detailNavStep("next", nav({ next: "t3" }))).toEqual({
      kind: "switch",
      ticketId: "t3",
    });
  });

  it("越界且有页可翻：翻页；越界且无页：死停", () => {
    expect(detailNavStep("next", nav({ hasNextPage: true }))).toEqual({
      kind: "crossPage",
      direction: "next",
    });
    expect(detailNavStep("prev", nav({ hasPrevPage: true }))).toEqual({
      kind: "crossPage",
      direction: "prev",
    });
    expect(detailNavStep("next", nav())).toBeNull();
    expect(detailNavStep("prev", nav())).toBeNull();
  });

  it("选中单不在切片里：有页可翻也死停——边界翻页的前提是人在边界", () => {
    expect(detailNavStep("next", nav({ inSlice: false, hasNextPage: true }))).toBeNull();
    expect(detailNavStep("prev", nav({ inSlice: false, hasPrevPage: true }))).toBeNull();
  });

  it("切片邻居优先于翻页", () => {
    expect(detailNavStep("next", nav({ next: "t2", hasNextPage: true }))).toEqual({
      kind: "switch",
      ticketId: "t2",
    });
  });
});

describe("handleDetailArrowKey", () => {
  function keyEvent(key: string) {
    return {
      key,
      target: { closest: () => null },
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent<HTMLElement>;
  }

  it("↑/← 走 prev，↓/→ 走 next", () => {
    const steps: string[] = [];
    const onStep = (step: { kind: string; ticketId?: string }) =>
      steps.push(`${step.kind}:${step.ticketId ?? ""}`);
    const both = nav({ prev: "t1", next: "t3" });

    handleDetailArrowKey(keyEvent("ArrowUp"), both, onStep);
    handleDetailArrowKey(keyEvent("ArrowLeft"), both, onStep);
    handleDetailArrowKey(keyEvent("ArrowDown"), both, onStep);
    handleDetailArrowKey(keyEvent("ArrowRight"), both, onStep);

    expect(steps).toEqual(["switch:t1", "switch:t1", "switch:t3", "switch:t3"]);
  });

  it("越界翻页交给 onStep；无路可走一步不动也不拦截按键", () => {
    const onStep = vi.fn();
    const crossable = nav({ hasNextPage: true });
    const down = keyEvent("ArrowDown");
    handleDetailArrowKey(down, crossable, onStep);
    expect(onStep).toHaveBeenCalledWith({ kind: "crossPage", direction: "next" });
    expect(down.preventDefault).toHaveBeenCalled();

    const dead = keyEvent("ArrowUp");
    handleDetailArrowKey(dead, nav(), onStep);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(dead.preventDefault).not.toHaveBeenCalled();
  });

  it("输入控件内的方向键归控件自己；非方向键不动作", () => {
    const onStep = vi.fn();
    const inInput = keyEvent("ArrowDown");
    inInput.target = { closest: () => document.createElement("input") } as unknown as HTMLElement;
    handleDetailArrowKey(inInput, nav({ next: "t2" }), onStep);
    handleDetailArrowKey(keyEvent("a"), nav({ next: "t2" }), onStep);
    expect(onStep).not.toHaveBeenCalled();
  });
});
