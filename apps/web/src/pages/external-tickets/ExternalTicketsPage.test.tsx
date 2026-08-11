import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
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
    processLogs: [],
  };
}

function renderPage(path = "/external-tickets", trpc: Record<string, unknown> = {}) {
  return renderApp({
    path,
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      "externalTicket.list": { items: [ticket()], total: 1 },
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

  it("宽屏着陆自动选中列表顶部第一单", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderPage("/external-tickets", {
      "externalTicket.list": {
        items: [ticket({ id: "t2", workOrderNumber: "WO100002" }), ticket()],
        total: 2,
      },
      "externalTicket.detail": detailPayload("t2"),
    });

    await waitFor(() => {
      expect(callsTo("externalTicket.detail")).toHaveLength(1);
    });
    expect(callsTo("externalTicket.detail")[0]?.input).toEqual({ ticketId: "t2" });
    // 选中后主从同屏：列表还在
    expect(await screen.findByRole("navigation", { name: "工单列表" })).toBeInTheDocument();
  });

  it("外部用户登录经 index redirect 落到本页", async () => {
    renderPage("/");
    expect(await screen.findByText("WO100001")).toBeInTheDocument();
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
