import { describe, expect, it } from "vitest";
import { substringSearchPattern, ticketListFilterConditions } from "./ticket-filter.ts";

describe("substringSearchPattern", () => {
  it("子串匹配:%直接拼接%", () => {
    expect(substringSearchPattern("WO123")).toBe("%WO123%");
  });

  it("不转义 LIKE 元字符:用户词里的 % 和 _ 按通配符生效", () => {
    expect(substringSearchPattern("50%")).toBe("%50%%");
    expect(substringSearchPattern("a_b")).toBe("%a_b%");
  });
});

describe("ticketListFilterConditions", () => {
  it("空状态集与缺省状态都不过滤", () => {
    expect(ticketListFilterConditions({ status: [] })).toEqual([]);
    expect(ticketListFilterConditions({})).toEqual([]);
  });

  it("非空状态集原样进入抽象条件", () => {
    expect(ticketListFilterConditions({ status: ["unassigned", "processing"] })).toEqual([
      { kind: "statusIn", statuses: ["unassigned", "processing"] },
    ]);
  });

  it("种类集原样进入抽象条件；空集与缺省都不过滤", () => {
    expect(ticketListFilterConditions({ kindId: ["kind-1", "kind-2"] })).toEqual([
      { kind: "kindIn", kindIds: ["kind-1", "kind-2"] },
    ]);
    expect(ticketListFilterConditions({ kindId: [] })).toEqual([]);
    expect(ticketListFilterConditions({})).toEqual([]);
  });

  it("搜索词原样保留,通配由 substringSearchPattern 负责", () => {
    expect(ticketListFilterConditions({ search: "50%" })).toEqual([
      { kind: "search", term: "50%" },
    ]);
  });

  it("空白搜索词等同未搜索", () => {
    expect(ticketListFilterConditions({ search: "" })).toEqual([]);
  });

  it("创建时间区间左闭右闭:gte/lte 成对出现", () => {
    expect(
      ticketListFilterConditions({
        createdFrom: "2026-08-01T00:00:00+08:00",
        createdTo: "2026-08-02T00:00:00+08:00",
      }),
    ).toEqual([
      {
        kind: "createdAtRange",
        gte: new Date("2026-08-01T00:00:00+08:00"),
        lte: new Date("2026-08-02T00:00:00+08:00"),
      },
    ]);
  });

  it("单侧边界只出一侧", () => {
    expect(ticketListFilterConditions({ createdFrom: "2026-08-01T00:00:00Z" })).toEqual([
      { kind: "createdAtRange", gte: new Date("2026-08-01T00:00:00Z") },
    ]);
    expect(ticketListFilterConditions({ createdTo: "2026-08-02T00:00:00Z" })).toEqual([
      { kind: "createdAtRange", lte: new Date("2026-08-02T00:00:00Z") },
    ]);
  });

  it("条件顺序稳定:状态、种类、搜索、日期区间", () => {
    expect(
      ticketListFilterConditions({
        createdTo: "2026-08-02T00:00:00Z",
        search: "WO",
        kindId: ["kind-1"],
        status: ["completed"],
      }),
    ).toEqual([
      { kind: "statusIn", statuses: ["completed"] },
      { kind: "kindIn", kindIds: ["kind-1"] },
      { kind: "search", term: "WO" },
      { kind: "createdAtRange", lte: new Date("2026-08-02T00:00:00Z") },
    ]);
  });
});
