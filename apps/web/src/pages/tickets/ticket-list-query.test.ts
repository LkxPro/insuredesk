import { describe, expect, it } from "vitest";
import { parseTicketListQuery, serializeSelection } from "./ticket-list-query";

describe("parseTicketListQuery", () => {
  it("空查询串三个新维度全缺省", () => {
    const query = parseTicketListQuery(new URLSearchParams());
    expect(query.assigneeId).toBeUndefined();
    expect(query.firstResponse).toBeUndefined();
    expect(query.slaPolicyId).toBeUndefined();
  });

  it("assigneeId 逗号分隔多值；空串参数 = 空选择（不过滤）", () => {
    expect(parseTicketListQuery(new URLSearchParams("assigneeId=u1,u2")).assigneeId).toEqual([
      "u1",
      "u2",
    ]);
    expect(parseTicketListQuery(new URLSearchParams("assigneeId=u1")).assigneeId).toEqual(["u1"]);
    expect(parseTicketListQuery(new URLSearchParams("assigneeId=")).assigneeId).toEqual([]);
  });

  it("firstResponse=pending 解析；非法值静默丢弃", () => {
    expect(parseTicketListQuery(new URLSearchParams("firstResponse=pending")).firstResponse).toBe(
      "pending",
    );
    expect(
      parseTicketListQuery(new URLSearchParams("firstResponse=done")).firstResponse,
    ).toBeUndefined();
  });

  it("slaPolicyId 规范名解析，字面值 none 原样透传", () => {
    expect(parseTicketListQuery(new URLSearchParams("slaPolicyId=none")).slaPolicyId).toEqual([
      "none",
    ]);
    expect(parseTicketListQuery(new URLSearchParams("slaPolicyId=p1,none")).slaPolicyId).toEqual([
      "p1",
      "none",
    ]);
  });

  it("policyId 遗留别名只读兼容；与规范名同现时规范名优先", () => {
    expect(parseTicketListQuery(new URLSearchParams("policyId=p1")).slaPolicyId).toEqual(["p1"]);
    expect(
      parseTicketListQuery(new URLSearchParams("slaPolicyId=p2&policyId=p1")).slaPolicyId,
    ).toEqual(["p2"]);
  });
});

describe("serializeSelection", () => {
  it("多值逗号连接；空选择无缺省时 = null（删参数）", () => {
    expect(serializeSelection(["a", "b"], [])).toBe("a,b");
    expect(serializeSelection([], [])).toBeNull();
  });

  it("与缺省集相同 = null；空选择有缺省 = 空串（显式清空）", () => {
    expect(serializeSelection(["a"], ["a"])).toBeNull();
    expect(serializeSelection([], ["a"])).toBe("");
  });
});
