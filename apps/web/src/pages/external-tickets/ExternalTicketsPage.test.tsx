import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { callsTo, renderApp, restFetch, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部端主页 = 主从单页：/external-tickets 与 /external-tickets/:id
 * 同一组件，:id 是选中态。宽屏着陆自动选中第一单（jsdom 无 matchMedia，
 * 默认走窄屏不自动选）；新建工单是对话框，提交成功自动选中新单。
 */

function ticket(overrides: Record<string, unknown> = {}) {
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
    latestLog: { action: "create", remark: "", at: "2026-07-09T02:00:00.000Z" },
    ...overrides,
  };
}

function detailPayload(id: string) {
  return {
    ticket: ticket({ id }),
    visibleFields: ["workOrderNumber", "status"],
    canAddNote: true,
    processLogs: [],
  };
}

function renderPage(path = "/external-tickets", trpc: Record<string, unknown> = {}) {
  return renderApp({
    path,
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      "externalTicket.list": {
        items: [ticket()],
        total: 1,
        visibleFields: ["workOrderNumber", "status"],
        detailVisibleFields: ["workOrderNumber", "status"],
      },
      "externalTicket.detail": detailPayload("t1"),
      ...trpc,
    },
  });
}

describe("主从布局", () => {
  it("窄屏（无 matchMedia）着陆不自动选中：列表可见，详情不拉取", async () => {
    renderPage();

    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    expect(callsTo("externalTicket.detail")).toHaveLength(0);
  });

  it("宽屏单一搜索结果自动打开详情", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderPage("/external-tickets?q=WO100002", {
      "externalTicket.list": {
        items: [ticket({ id: "t2", workOrderNumber: "WO100002" })],
        total: 1,
        visibleFields: ["workOrderNumber", "status"],
        detailVisibleFields: ["workOrderNumber", "status"],
      },
      "externalTicket.detail": detailPayload("t2"),
    });

    await waitFor(() => {
      expect(callsTo("externalTicket.detail")).toHaveLength(1);
    });
    expect(callsTo("externalTicket.detail")[0]?.input).toEqual({ ticketId: "t2" });
    // 选中后主从同屏：二级列表还在
    expect(await screen.findByRole("navigation", { name: "工单列表" })).toBeInTheDocument();
  });

  it("外部用户登录经 index redirect 落到本页", async () => {
    renderPage("/");
    expect(await screen.findByText("WO100001")).toBeInTheDocument();
  });

  it("restores the full-list scroll position after closing a detail", async () => {
    renderPage();
    const list = await screen.findByRole("navigation", { name: "工单列表" });
    list.scrollTop = 160;
    fireEvent.scroll(list);

    fireEvent.click(screen.getByText("WO100001"));
    fireEvent.click(await screen.findByRole("button", { name: "关闭详情" }));

    const restored = await screen.findByRole("navigation", { name: "工单列表" });
    expect(restored.scrollTop).toBe(160);
  });
});

describe("新建工单", () => {
  function openDialog() {
    fireEvent.click(screen.getByRole("button", { name: "新建工单" }));
    return screen.findByLabelText("工单原文");
  }

  it("提交成功：toast、列表作废、自动选中新单", async () => {
    renderPage("/external-tickets", {
      "externalTicket.submit": { id: "t9", workOrderNumber: "WO100009" },
      "externalTicket.detail": detailPayload("t9"),
    });
    const box = await openDialog();

    fireEvent.change(box, { target: { value: "  客户要求退保  " } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));

    await waitFor(() => {
      expect(callsTo("externalTicket.submit")).toHaveLength(1);
    });
    // 前后空白在提交前裁掉
    expect(callsTo("externalTicket.submit")[0]?.input).toEqual({
      submissionText: "客户要求退保",
    });
    expect(toastSpies.success).toHaveBeenCalledWith("工单 WO100009 已提交");

    // 对话框关闭，新单被选中（详情拉取 t9），列表因作废而重拉
    await waitFor(() => {
      expect(screen.queryByLabelText("工单原文")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        callsTo("externalTicket.detail").some(
          (call) => (call.input as { ticketId?: string })?.ticketId === "t9",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(callsTo("externalTicket.list").length).toBeGreaterThan(1);
    });
  });

  it("caps 原文 at 2000 chars and shows the counter", async () => {
    renderPage();
    const box = await openDialog();
    expect(box).toHaveAttribute("maxLength", "2000");

    fireEvent.change(box, { target: { value: "字".repeat(12) } });
    expect(screen.getByText("12 / 2000 字，提交后不可修改。")).toBeInTheDocument();
  });

  it("blocks an empty 原文 client-side", async () => {
    renderPage();
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));

    expect(await screen.findByText("请填写工单原文")).toBeInTheDocument();
    expect(callsTo("externalTicket.submit")).toHaveLength(0);
  });

  it("surfaces a server-side rejection in the dialog and keeps the draft", async () => {
    renderPage("/external-tickets", {
      "externalTicket.submit": () => {
        throw new Error("原文含有敏感信息");
      },
    });
    const box = await openDialog();

    fireEvent.change(box, { target: { value: "客户电话 13800001111" } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));

    expect(await screen.findByText("原文含有敏感信息")).toBeInTheDocument();
    expect(screen.getByLabelText("工单原文")).toHaveValue("客户电话 13800001111");
  });
});

describe("个人字段顺序", () => {
  it("saves independent list and export orders", async () => {
    renderPage("/external-tickets", {
      "externalTicket.preferences": {
        listFields: ["workOrderNumber", "status"],
        exportFields: ["customerName", "phone"],
        defaultListFields: ["workOrderNumber", "status"],
        defaultExportFields: ["customerName", "phone"],
      },
      "externalTicket.updatePreferences": (input: unknown) => ({
        fields: (input as { fields: string[] }).fields,
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "字段顺序" }));
    fireEvent.click(await screen.findByRole("button", { name: /上移 .*电话/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));

    await waitFor(() => {
      expect(callsTo("externalTicket.updatePreferences")).toHaveLength(1);
    });
    expect(callsTo("externalTicket.updatePreferences")[0]?.input).toEqual({
      surface: "export",
      fields: ["phone", "customerName"],
    });
  });
});

describe("筛选与导出", () => {
  it("sends completion status and feedback filters, then exports without pagination", async () => {
    restFetch.mockResolvedValue(
      new Response("\uFEFF工单号\r\nWO100001\r\n", {
        status: 200,
        headers: { "content-type": "text/csv" },
      }),
    );
    renderPage(
      "/external-tickets?status=processing&completion=resolved&q=张三&from=2026-08-01&to=2026-08-07&page=3",
      {
        "completionStatus.filterOptions": [{ id: "resolved", name: "已解决", active: true }],
      },
    );

    await waitFor(() => {
      expect(callsTo("externalTicket.list")[0]?.input).toMatchObject({
        status: ["processing"],
        completionStatusId: ["resolved"],
        search: "张三",
        offset: 40,
      });
    });
    const exportButton = await screen.findByRole("button", { name: "导出" });
    fireEvent.pointerDown(exportButton, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(exportButton);
    fireEvent.click(await screen.findByText(/CSV/));

    await waitFor(() => expect(restFetch).toHaveBeenCalledTimes(1));
    expect(String(restFetch.mock.calls[0]?.[0])).toContain(
      "/api/external-tickets/export?format=csv",
    );
    expect(String(restFetch.mock.calls[0]?.[0])).toContain("completionStatusId=resolved");
    expect(String(restFetch.mock.calls[0]?.[0])).not.toContain("page=3");
  });
});
