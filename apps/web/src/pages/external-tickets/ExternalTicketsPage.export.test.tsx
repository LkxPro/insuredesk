import type { Permission } from "@insuredesk/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, restFetch, type TestRole } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部列表的日期筛选与导出：筛选值住 URL（深链/刷新不丢）、查询随车；
 * 导出按钮按 ticket.export_external 权限位出现，点击经全局 fetch 下载
 * （restFetch），URL 带当前筛选、无翻页参数。
 */

function ticket() {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    status: "processing",
    submissionText: "客户反馈无法登录",
    createdAt: "2026-07-09T02:00:00.000Z",
    feedbackTime: null,
    channelId: null,
    channelName: null,
    project: null,
    brokerageEntity: null,
    paymentChannel: null,
    userComplaintChannel: null,
    complaintReceiveChannel: null,
    nuclearBodyStatus: null,
    customerRequest: null,
    hasContacted: null,
    contactTime: null,
    categoryId: null,
    categoryName: null,
    complaintLevel: null,
    priority: null,
    processingResult: null,
    completionStatusId: null,
    completionStatusName: null,
    completionTime: null,
    latestLog: null,
  };
}

/** 持导出位之外与种子缺省同形的外部角色。 */
const EXTERNAL_NO_EXPORT = {
  name: "外部用户",
  permissions: ["ticket.create_external", "ticket.process_external"] as Permission[],
};

function renderPage(path: string, role: TestRole = TEST_ROLES.EXTERNAL) {
  return renderApp({
    path,
    role,
    isExternal: true,
    trpc: { "externalTicket.list": { items: [ticket()], total: 1 } },
  });
}

/** Open the Radix dropdown (pointerDown, jsdom-style) and pick a format. */
async function pickExport(itemName: RegExp) {
  const trigger = await screen.findByRole("button", { name: /导出/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: itemName }));
}

describe("创建日期筛选", () => {
  it("选预设后 list 查询带上 createdFrom/createdTo", async () => {
    renderPage("/external-tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: /创建时间筛选/ }));
    fireEvent.click(await screen.findByRole("button", { name: "近 7 天" }));

    await waitFor(() => {
      const inputs = callsTo("externalTicket.list").map((call) => call.input) as Array<{
        createdFrom?: string;
        createdTo?: string;
      }>;
      const last = inputs.at(-1);
      expect(last?.createdFrom).toBeDefined();
      expect(last?.createdTo).toBeDefined();
      expect(Number.isNaN(Date.parse(last?.createdFrom ?? ""))).toBe(false);
      expect(Number.isNaN(Date.parse(last?.createdTo ?? ""))).toBe(false);
    });
  });

  it("URL 深链带入区间；畸形边界按未筛选处理", async () => {
    const from = "2026-07-06T00:00:00.000Z";
    const to = "2026-07-12T23:59:59.999Z";
    renderPage(
      `/external-tickets?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}`,
    );
    await screen.findByText("WO100001");

    const linked = callsTo("externalTicket.list").at(-1)?.input as {
      createdFrom?: string;
      createdTo?: string;
    };
    expect(linked.createdFrom).toBe(from);
    expect(linked.createdTo).toBe(to);
  });

  it("畸形 createdFrom 退回未筛选，不下传", async () => {
    renderPage("/external-tickets?createdFrom=昨天");
    await screen.findByText("WO100001");

    const input = callsTo("externalTicket.list").at(-1)?.input as Record<string, unknown>;
    expect(input.createdFrom).toBeUndefined();
  });
});

describe("导出", () => {
  it("有权限位：导出按钮在筛选栏，CSV 下载带当前筛选、无翻页参数", async () => {
    restFetch.mockResolvedValue(
      new Response("csv", { status: 200, headers: { "content-type": "text/csv" } }),
    );
    const from = "2026-07-06T00:00:00.000Z";
    renderPage(
      `/external-tickets?status=processing&q=PX-1&completed=1&createdFrom=${encodeURIComponent(from)}&page=2`,
    );

    await pickExport(/CSV/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/external-tickets/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("status")).toBe("processing");
    expect(url.searchParams.get("search")).toBe("PX-1");
    expect(url.searchParams.get("includeCompleted")).toBe("1");
    expect(url.searchParams.get("createdFrom")).toBe(from);
    expect(url.searchParams.get("timeZone")).toBeTruthy();
    // 导出覆盖筛选结果全集 — 翻页不随车
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("选择 Excel 时请求 xlsx", async () => {
    restFetch.mockResolvedValue(new Response("x", { status: 200 }));
    renderPage("/external-tickets");

    await pickExport(/Excel/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("format")).toBe("xlsx");
  });

  it("权限位关闭后按钮不出现", async () => {
    renderPage("/external-tickets", EXTERNAL_NO_EXPORT);
    await screen.findByText("WO100001");

    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
  });
});
