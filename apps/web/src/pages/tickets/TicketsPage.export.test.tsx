import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTicketExportUrl } from "@/pages/ticket-surface/ticket-export";
import { auth, renderApp, restFetch, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

function renderAt(path: string) {
  return renderApp({
    path,
    trpc: { "channel.filterOptions": [{ id: "ch-pay", name: "支付", active: true }] },
  });
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

async function pickExport(itemName: RegExp) {
  const trigger = await screen.findByRole("button", { name: /导出/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: itemName }));
}

describe("按列表当前筛选条件导出", () => {
  it("downloads via /api/tickets/export with the current filters and picked format", async () => {
    restFetch.mockResolvedValue(
      new Response("csv", { status: 200, headers: { "content-type": "text/csv" } }),
    );
    renderAt(
      "/tickets?status=overdue,completed&channel=ch-pay,ch-bank&q=三丰&sortBy=dueAt&sortOrder=asc&page=3",
    );

    await pickExport(/CSV/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/tickets/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("status")).toBe("overdue,completed");
    expect(url.searchParams.get("channelId")).toBe("ch-pay,ch-bank");
    expect(url.searchParams.get("search")).toBe("三丰");
    expect(url.searchParams.get("sortBy")).toBe("dueAt");
    expect(url.searchParams.get("sortOrder")).toBe("asc");
    expect(url.searchParams.get("timeZone")).toBeTruthy();
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("默认筛选下导出同样排除归档单（来源缺省跟随下传）", async () => {
    restFetch.mockResolvedValue(new Response("x", { status: 200 }));
    renderAt("/tickets");

    await pickExport(/CSV/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("source")).toBe("feishu_form,manual,community,external_channel");
  });

  it("创建时间区间随导出下传（导出口径 = 列表口径）", async () => {
    restFetch.mockResolvedValue(new Response("x", { status: 200 }));
    const from = "2026-07-06T00:00:00.000Z";
    const to = "2026-07-12T23:59:59.999Z";
    renderAt(
      `/tickets?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}`,
    );

    await pickExport(/CSV/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("createdFrom")).toBe(from);
    expect(url.searchParams.get("createdTo")).toBe(to);
  });

  it("时效策略筛选随导出下传（policyId → slaPolicyId）", async () => {
    restFetch.mockResolvedValue(new Response("x", { status: 200 }));
    renderAt("/tickets?policyId=pol-urgent,pol-normal");

    await pickExport(/CSV/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("slaPolicyId")).toBe("pol-urgent,pol-normal");
    expect(url.searchParams.get("complaintLevel")).toBeNull();
  });

  it("requests xlsx when Excel is picked", async () => {
    restFetch.mockResolvedValue(new Response("x", { status: 200 }));
    renderAt("/tickets");

    await pickExport(/Excel/);

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(restFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("format")).toBe("xlsx");
  });

  it("surfaces a server rejection as a toast", async () => {
    restFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing required permission: ticket.export" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    renderAt("/tickets");

    await pickExport(/CSV/);

    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("Missing required permission: ticket.export"),
    );
  });
});

describe("buildTicketExportUrl", () => {
  it("omits unset filters and keeps set ones, with an explicit zone", () => {
    const url = buildTicketExportUrl(
      {
        status: ["processing"],
        channelId: undefined,
        categoryId: undefined,
        completionStatusId: undefined,
        slaPolicyId: ["pol-urgent"],
        source: ["manual"],
        search: undefined,
        sortBy: "createdAt",
        sortOrder: "desc",
        page: 5,
        pageSize: 20,
      },
      "xlsx",
      "Asia/Shanghai",
    );
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("status")).toBe("processing");
    expect(params.get("slaPolicyId")).toBe("pol-urgent");
    expect(params.get("complaintLevel")).toBeNull();
    expect(params.get("channelId")).toBeNull();
    expect(params.get("source")).toBe("manual");
    expect(params.get("search")).toBeNull();
    expect(params.get("timeZone")).toBe("Asia/Shanghai");
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("joins multi-selections with commas; 空选来源显式下传空值以覆盖服务端缺省", () => {
    const url = buildTicketExportUrl(
      {
        status: ["overdue", "completed"],
        channelId: ["ch-pay", "ch-bank"],
        categoryId: undefined,
        completionStatusId: undefined,
        slaPolicyId: undefined,
        source: [],
        search: "三丰",
        sortBy: "dueAt",
        sortOrder: "asc",
        page: 1,
        pageSize: 20,
      },
      "csv",
      "UTC",
    );
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("status")).toBe("overdue,completed");
    expect(params.get("channelId")).toBe("ch-pay,ch-bank");
    expect(params.get("source")).toBe("");
    expect(params.get("search")).toBe("三丰");
  });
});
