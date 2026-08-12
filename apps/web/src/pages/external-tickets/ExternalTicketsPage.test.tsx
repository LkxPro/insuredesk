import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部端主页：/external-tickets 是全宽表格一级列表（着陆不自动选中、不跳转），
 * 整行点进 /external-tickets/:id 整页详情；新建工单是对话框，提交成功进新单
 * 详情。
 */

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    status: "processing",
    submissionText: "客户反馈无法登录",
    createdAt: "2026-07-09T02:00:00.000Z",
    feedbackTime: "2026-07-09T02:00:00.000Z",
    customerName: null,
    policyNumbers: [],
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

describe("列表页", () => {
  it("着陆为全宽表格：7 列表头就位，不拉详情不跳转", async () => {
    renderPage();

    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    for (const name of [
      "工单号",
      "反馈时间",
      "保单号",
      "客户姓名",
      "状态",
      "客服最近跟进记录",
      "完结状态",
    ]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(callsTo("externalTicket.detail")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
  });

  it("列渲染：跟进记录截断显示、完结状态缺省「未完结」、客服新发言徽标挂工单号格", async () => {
    renderPage("/external-tickets", {
      "externalTicket.list": {
        items: [
          ticket({
            customerName: "张三",
            policyNumbers: ["P123"],
            latestLog: {
              action: "comment",
              remark: "已联系客户，等待回复",
              at: "2026-07-10T02:00:00.000Z",
            },
          }),
        ],
        total: 1,
      },
    });

    const row = (await screen.findByText("WO100001")).closest("tr") as HTMLElement;
    expect(within(row).getByText("张三")).toBeInTheDocument();
    expect(within(row).getByText("P123")).toBeInTheDocument();
    expect(within(row).getByText("已联系客户，等待回复")).toBeInTheDocument();
    expect(within(row).getByText("未完结")).toBeInTheDocument();
    expect(within(row).getByText("客服新发言")).toBeInTheDocument();
  });

  it("最新记录是 create（remark 为空）：跟进列留空、无新发言徽标", async () => {
    renderPage();

    const row = (await screen.findByText("WO100001")).closest("tr") as HTMLElement;
    expect(within(row).queryByText("客服新发言")).not.toBeInTheDocument();
    const cells = within(row).getAllByRole("cell");
    expect(cells[5]).toHaveTextContent("");
  });

  it("整行点进整页详情，「返回列表」回到表格", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("处理中"));

    expect(await screen.findByRole("region", { name: "工单详情" })).toBeInTheDocument();
    expect(callsTo("externalTicket.detail")[0]?.input).toEqual({ ticketId: "t1" });

    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("columnheader", { name: "工单号" })).toBeInTheDocument();
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

  it("提交成功：toast、列表作废、进新单详情", async () => {
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

    // 对话框关闭，进了新单详情（拉取 t9），列表因作废而重拉
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
