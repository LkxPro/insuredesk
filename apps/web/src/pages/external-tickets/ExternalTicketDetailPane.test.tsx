import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 右栏详情，镜像内部双栏：头部（工单号+状态+常驻 X）→ 左栏工单原文直出 +
 * 全部有值字段平铺，右栏处理记录时间线 + 钉底留言框（已完结无）。↑/↓ 按
 * 列表顺序翻单。时间线内容筛选在服务端，这里验证字段渲染、折叠行为、
 * 留言流、翻单与两个返回出口。
 */

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    status: "processing",
    submissionText: "客户反馈保单无法下载\n第二行",
    createdAt: "2026-07-09T02:00:00.000Z",
    feedbackTime: "2026-07-09T01:00:00.000Z",
    channelId: "c1",
    channelName: "微信",
    project: null,
    brokerageEntity: null,
    paymentChannel: null,
    userComplaintChannel: null,
    complaintReceiveChannel: null,
    nuclearBodyStatus: null,
    customerRequest: null,
    hasContacted: true,
    contactTime: null,
    categoryId: null,
    categoryName: null,
    complaintLevel: null,
    priority: "high",
    processingResult: null,
    completionStatusId: null,
    completionStatusName: null,
    completionTime: null,
    ...overrides,
  };
}

type DetailOverrides = {
  ticket?: Record<string, unknown>;
  processLogs?: unknown[];
};

function detailPayload(overrides: DetailOverrides = {}) {
  const { ticket: ticketOverrides = {}, ...rest } = overrides;
  return {
    ticket: ticket(ticketOverrides),
    processLogs: [],
    ...rest,
  };
}

function renderDetail(overrides: DetailOverrides = {}, extraTrpc: Record<string, unknown> = {}) {
  return renderApp({
    path: "/external-tickets/t1",
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      "externalTicket.detail": detailPayload(overrides),
      // 返回出口用例会回到无选中的列表：给列表一行可渲染的数据
      "externalTicket.list": {
        items: [
          { ...ticket(), latestLog: { action: "create", remark: "", at: ticket().createdAt } },
        ],
        total: 1,
      },
      ...extraTrpc,
    },
  });
}

async function findPaneShowing(workOrderNumber: string) {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent(workOrderNumber));
  return pane;
}

describe("头部", () => {
  it("shows 工单号与状态", async () => {
    renderDetail();
    // jsdom 无 CSS：选中态下列表行也在 DOM 里，状态徽标会出现两次，断言语义挂在详情头部
    const header = (await screen.findByRole("heading", { name: "WO100001" }))
      .parentElement as HTMLElement;
    expect(within(header).getByText("处理中")).toBeInTheDocument();
  });

  it("窄屏返回键回到无选中的列表", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "WO100001" });

    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
    });
  });

  it("常驻「关闭详情」同样回到无选中的列表", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "WO100001" });

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
    });
  });
});

describe("处理记录时间线", () => {
  const logs = [
    {
      id: "l1",
      action: "create",
      remark: "工单创建",
      createdAt: "2026-07-09T02:00:00.000Z",
      operatorId: "u9",
      operatorName: "外部用户",
    },
    {
      id: "l2",
      action: "comment",
      remark: "已联系客户，正在核实",
      createdAt: "2026-07-09T03:00:00.000Z",
      operatorId: "u1",
      operatorName: "客服小王",
    },
    {
      id: "l3",
      action: "external_note",
      remark: "补充：保单号 P123",
      createdAt: "2026-07-09T04:00:00.000Z",
      operatorId: "u9",
      operatorName: "外部用户",
    },
  ];

  it("renders each log with its action label, operator and remark", async () => {
    renderDetail({ processLogs: logs });
    await screen.findByText("处理记录");

    expect(screen.getByText("工单创建")).toBeInTheDocument();
    expect(screen.getByText("已联系客户，正在核实")).toBeInTheDocument();
    expect(screen.getByText("客服小王")).toBeInTheDocument();
    // 外部留言与内部跟进同列呈现，靠 action 标签区分
    expect(screen.getByText("外部留言")).toBeInTheDocument();
    expect(screen.getByText("补充：保单号 P123")).toBeInTheDocument();
  });

  it("empty timeline says so", async () => {
    renderDetail();
    expect(await screen.findByText("还没有处理记录。")).toBeInTheDocument();
  });
});

describe("左栏", () => {
  it("原文直接呈现（换行保留），无折叠开关", async () => {
    renderDetail();
    const pane = await findPaneShowing("WO100001");

    const text = within(pane).getByText(/客户反馈保单无法下载/);
    expect(text).toHaveClass("whitespace-pre-wrap");
    expect(within(pane).queryByRole("button", { name: /工单原文/ })).not.toBeInTheDocument();
  });

  it("全部有值字段平铺直出：有值渲染，无值整条不出现", async () => {
    renderDetail();
    const pane = await findPaneShowing("WO100001");

    // 有值 → 直接可见（渠道走 JOIN 出的名字，枚举走中文标签，布尔走是/否）
    expect(within(pane).getByText("微信")).toBeInTheDocument();
    expect(within(pane).getByText("高")).toBeInTheDocument();
    expect(within(pane).getByText("是")).toBeInTheDocument();
    // 无值 → 整条不渲染，不留 —
    expect(within(pane).queryByText("类别")).not.toBeInTheDocument();
    expect(within(pane).queryByText("最新跟进")).not.toBeInTheDocument();
  });

  it("工单号与状态已挂在头部，字段栅格不重复", async () => {
    renderDetail();
    const pane = await findPaneShowing("WO100001");

    expect(within(pane).queryByText("工单号")).not.toBeInTheDocument();
    expect(within(pane).queryByText("状态")).not.toBeInTheDocument();
  });

  it("栅格全空时给出提示", async () => {
    renderDetail({
      ticket: {
        feedbackTime: null,
        channelId: null,
        channelName: null,
        priority: null,
        hasContacted: null,
      },
    });
    expect(await screen.findByText("客服团队还未补充工单信息。")).toBeInTheDocument();
  });
});

describe("外部留言", () => {
  it("submits the note and refetches the detail", async () => {
    renderDetail({}, { "externalTicket.addNote": { success: true } });
    const box = await screen.findByLabelText("留言内容");

    const submit = screen.getByRole("button", { name: "提交留言" });
    expect(submit).toBeDisabled(); // 空留言不可提交

    fireEvent.change(box, { target: { value: "保单号是 P123" } });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(callsTo("externalTicket.addNote")).toHaveLength(1);
    });
    expect(callsTo("externalTicket.addNote")[0]?.input).toEqual({
      ticketId: "t1",
      content: "保单号是 P123",
    });
    expect(toastSpies.success).toHaveBeenCalledWith("留言已提交");
    // 时间线要带上新留言；列表也要重拉（徽标/置顶位随最新记录易主而变）
    await waitFor(() => {
      expect(callsTo("externalTicket.detail").length).toBeGreaterThan(1);
    });
    await waitFor(() => {
      expect(callsTo("externalTicket.list").length).toBeGreaterThan(1);
    });
    await waitFor(() => {
      expect(screen.getByLabelText("留言内容")).toHaveValue("");
    });
  });

  it("已完结 hides the note form entirely", async () => {
    renderDetail({ ticket: { status: "completed" } });
    await screen.findByText("处理记录");
    expect(screen.queryByLabelText("留言内容")).not.toBeInTheDocument();
  });
});

describe("↑/↓ 翻单", () => {
  const detailIds = () =>
    callsTo("externalTicket.detail").map((call) => (call.input as { ticketId: string }).ticketId);

  function renderTwo() {
    return renderApp({
      path: "/external-tickets/t1",
      role: TEST_ROLES.EXTERNAL,
      isExternal: true,
      trpc: {
        "externalTicket.list": {
          items: [
            { ...ticket(), latestLog: null },
            { ...ticket({ id: "t2", workOrderNumber: "WO100002" }), latestLog: null },
          ],
          total: 2,
        },
        "externalTicket.detail": (input: { ticketId: string }) =>
          detailPayload({
            ticket:
              input.ticketId === "t1" ? {} : { id: input.ticketId, workOrderNumber: "WO100002" },
          }),
      },
    });
  }

  it("↓ 切到列表下一单，↑ 切回；首行 ↑ 不动作", async () => {
    renderTwo();
    const pane = await findPaneShowing("WO100001");

    fireEvent.keyDown(pane, { key: "ArrowDown" });
    await findPaneShowing("WO100002");

    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowUp" });
    await findPaneShowing("WO100001");

    // 首行 ↑：不翻页、不报错、不重拉
    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowUp" });
    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100001");
    expect(detailIds()).toEqual(["t1", "t2", "t1"]);
  });
});
