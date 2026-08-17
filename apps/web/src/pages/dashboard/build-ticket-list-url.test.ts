import { describe, expect, it } from "vitest";
import { buildChannelTicketListUrl, buildTicketListUrl } from "./build-ticket-list-url";

/**
 * 看板 → 列表 URL 构造：每张卡与每一渠道行点击后跳转列表，URL 携带与该卡/行
 * 精确等价的筛选条件。所有跳转都附带看板当前的 createdFrom/createdTo。
 */

describe("buildTicketListUrl", () => {
  it("total card returns no status filter", () => {
    expect(buildTicketListUrl("total", {})).toBe("/tickets");
  });

  it("unassigned card returns status=unassigned", () => {
    expect(buildTicketListUrl("unassigned", {})).toBe("/tickets?status=unassigned");
  });

  it("assigned card returns status=assigned", () => {
    expect(buildTicketListUrl("assigned", {})).toBe("/tickets?status=assigned");
  });

  it("processing card returns status=processing", () => {
    expect(buildTicketListUrl("processing", {})).toBe("/tickets?status=processing");
  });

  it("completed card returns status=completed", () => {
    expect(buildTicketListUrl("completed", {})).toBe("/tickets?status=completed");
  });

  it("pendingTimeout card returns status=pending_timeout", () => {
    expect(buildTicketListUrl("pendingTimeout", {})).toBe("/tickets?status=pending_timeout");
  });

  it("overdue card returns status=overdue", () => {
    expect(buildTicketListUrl("overdue", {})).toBe("/tickets?status=overdue");
  });

  it("urgent card returns policyId of the bound top-sortOrder active policy", () => {
    expect(buildTicketListUrl("urgent", {}, "pol-top")).toBe("/tickets?policyId=pol-top");
  });

  it("urgent card degrades to an unfiltered list when no active policy exists", () => {
    expect(buildTicketListUrl("urgent", {}, null)).toBe("/tickets");
  });

  it("urgent card keeps the time range alongside policyId", () => {
    expect(
      buildTicketListUrl("urgent", { createdFrom: "2026-07-01", createdTo: "2026-07-31" }, "p1"),
    ).toBe("/tickets?policyId=p1&createdFrom=2026-07-01&createdTo=2026-07-31");
  });

  it("includes createdFrom when present", () => {
    expect(buildTicketListUrl("total", { createdFrom: "2026-07-01" })).toBe(
      "/tickets?createdFrom=2026-07-01",
    );
  });

  it("includes createdTo when present", () => {
    expect(buildTicketListUrl("total", { createdTo: "2026-07-31" })).toBe(
      "/tickets?createdTo=2026-07-31",
    );
  });

  it("includes both createdFrom and createdTo when both present", () => {
    expect(
      buildTicketListUrl("overdue", { createdFrom: "2026-07-01", createdTo: "2026-07-31" }),
    ).toBe("/tickets?status=overdue&createdFrom=2026-07-01&createdTo=2026-07-31");
  });

  it("total card with time range includes only time params", () => {
    expect(
      buildTicketListUrl("total", { createdFrom: "2026-07-01", createdTo: "2026-07-31" }),
    ).toBe("/tickets?createdFrom=2026-07-01&createdTo=2026-07-31");
  });
});

describe("buildChannelTicketListUrl", () => {
  it("returns channel filter with the given channelId", () => {
    expect(buildChannelTicketListUrl("ch-1", {})).toBe("/tickets?channel=ch-1");
  });

  it("includes createdFrom when present", () => {
    expect(buildChannelTicketListUrl("ch-1", { createdFrom: "2026-07-01" })).toBe(
      "/tickets?channel=ch-1&createdFrom=2026-07-01",
    );
  });

  it("includes createdTo when present", () => {
    expect(buildChannelTicketListUrl("ch-1", { createdTo: "2026-07-31" })).toBe(
      "/tickets?channel=ch-1&createdTo=2026-07-31",
    );
  });

  it("includes both createdFrom and createdTo when both present", () => {
    expect(
      buildChannelTicketListUrl("ch-2", { createdFrom: "2026-07-01", createdTo: "2026-07-31" }),
    ).toBe("/tickets?channel=ch-2&createdFrom=2026-07-01&createdTo=2026-07-31");
  });
});
