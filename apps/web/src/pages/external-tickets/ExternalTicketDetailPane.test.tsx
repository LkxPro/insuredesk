import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 详情区，镜像内部双栏：头部（返回列表+工单号+状态+翻单按钮）→ 左栏工单
 * 原文直出 + 固定字段（保单号/客户/两电话，空值 —），右栏处理记录时间线 +
 * 钉底留言框（已完结无）。↑/↓ 按列表顺序翻单。时间线内容筛选在服务端，这里
 * 验证字段渲染、留言流、翻单与返回出口。
 */

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    status: "processing",
    submissionText: "客户反馈保单无法下载\n第二行",
    createdAt: "2026-07-09T02:00:00.000Z",
    feedbackTime: "2026-07-09T01:00:00.000Z",
    customerName: null,
    policyNumbers: [],
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
    const header = (await screen.findByRole("heading", { name: "WO100001" }))
      .parentElement as HTMLElement;
    expect(within(header).getByText("处理中")).toBeInTheDocument();
  });

  it("返回键回到列表", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "WO100001" });

    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));

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

    // 系统动作（创建）是合并的一行：只留标签与操作人，备注不展示
    expect(screen.getByText(/创建工单/)).toBeInTheDocument();
    expect(screen.queryByText("工单创建")).not.toBeInTheDocument();
    // 沟通条目（跟进/留言）是气泡：类型徽章 + 操作人 + 备注全文
    expect(screen.getByText("跟进记录")).toBeInTheDocument();
    expect(screen.getByText("已联系客户，正在核实")).toBeInTheDocument();
    expect(screen.getByText("客服小王")).toBeInTheDocument();
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

  it("原文为空显示 —", async () => {
    renderDetail({ ticket: { submissionText: null } });
    const pane = await findPaneShowing("WO100001");

    expect(within(pane).getByText("工单原文").parentElement).toHaveTextContent("—");
  });

  it("只渲染 保单号/客户/两个电话 四个字段，空值落 —，其余字段有值也不出", async () => {
    renderDetail({
      ticket: {
        customerName: "张三",
        phone: "13800000000",
        policyNumbers: ["P123", "P456"],
      },
    });
    const pane = await findPaneShowing("WO100001");

    // 标签与内部详情同口径
    expect(within(pane).getByText("保单号")).toBeInTheDocument();
    expect(within(pane).getByText("P123 P456")).toBeInTheDocument();
    expect(within(pane).getByText("客户姓名")).toBeInTheDocument();
    expect(within(pane).getByText("张三")).toBeInTheDocument();
    expect(within(pane).getByText("客户电话（投保人）")).toBeInTheDocument();
    expect(within(pane).getByText("13800000000")).toBeInTheDocument();
    // 空值整条仍在，落 —（fixture 的 contactPhone 未填）
    expect(within(pane).getByText("联系人电话（备用）").parentElement).toHaveTextContent("—");

    // 其余字段有值也不渲染（fixture 自带 渠道=微信 / 优先级=高 / 已联系=是）
    expect(within(pane).queryByText("微信")).not.toBeInTheDocument();
    expect(within(pane).queryByText("优先级")).not.toBeInTheDocument();
    expect(within(pane).queryByText("是否已联系")).not.toBeInTheDocument();
    expect(within(pane).queryByText("客服团队还未补充工单信息。")).not.toBeInTheDocument();
  });

  it("工单号与状态已挂在头部，字段栅格不重复", async () => {
    renderDetail();
    const pane = await findPaneShowing("WO100001");

    expect(within(pane).queryByText("工单号")).not.toBeInTheDocument();
    expect(within(pane).queryByText("状态")).not.toBeInTheDocument();
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

describe("跨页翻单 (issue #186)", () => {
  // PAGE_SIZE=20：total=21 造两页，页 1 给 t1/t2，页 2 只有 t3
  function renderPagedAt(path: string) {
    return renderApp({
      path,
      role: TEST_ROLES.EXTERNAL,
      isExternal: true,
      trpc: {
        "externalTicket.list": (input: { offset?: number }) => ({
          items:
            (input.offset ?? 0) === 0
              ? [
                  { ...ticket(), latestLog: null },
                  { ...ticket({ id: "t2", workOrderNumber: "WO100002" }), latestLog: null },
                ]
              : [{ ...ticket({ id: "t3", workOrderNumber: "WO100003" }), latestLog: null }],
          total: 21,
        }),
        "externalTicket.detail": (input: { ticketId: string }) =>
          detailPayload({
            ticket: { id: input.ticketId, workOrderNumber: `WO10000${input.ticketId.slice(1)}` },
          }),
      },
    });
  }

  it("页 1 末行 ↓ 翻到页 2 选中第一条（列表查询带上新页 offset）", async () => {
    renderPagedAt("/external-tickets/t2");
    const pane = await findPaneShowing("WO100002");

    fireEvent.keyDown(pane, { key: "ArrowDown" });

    await findPaneShowing("WO100003");
    const offsets = callsTo("externalTicket.list").map(
      (call) => (call.input as { offset?: number }).offset ?? 0,
    );
    expect(offsets).toContain(20);
  });

  it("页 2 首行 ↑ 翻回页 1 选中最后一条", async () => {
    renderPagedAt("/external-tickets/t3?page=2");
    const pane = await findPaneShowing("WO100003");

    fireEvent.keyDown(pane, { key: "ArrowUp" });

    await findPaneShowing("WO100002");
  });

  it("深链单不在当前页切片：方向键与按钮都死停，不翻页", async () => {
    renderPagedAt("/external-tickets/t3");
    const pane = await findPaneShowing("WO100003");

    fireEvent.keyDown(pane, { key: "ArrowDown" });

    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100003");
    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一条工单" })).toBeDisabled();
    const offsets = callsTo("externalTicket.list").map(
      (call) => (call.input as { offset?: number }).offset ?? 0,
    );
    expect(offsets.every((offset) => offset === 0)).toBe(true);
  });

  it("←/→ 与 ↑/↓ 同向；prev/next 按钮同一逻辑、边界处禁用", async () => {
    renderPagedAt("/external-tickets/t2?page=1");
    const pane = await findPaneShowing("WO100002");

    // → 越界 = ↓：页 1 末行按 → 翻到页 2 第一条
    fireEvent.keyDown(pane, { key: "ArrowRight" });
    await findPaneShowing("WO100003");

    // 末页末行：下一条按钮禁用；上一条按钮 = ← 越界翻回页 1 末行
    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一条工单" }));
    await findPaneShowing("WO100002");

    // 页 1 内：← = ↑ 切片内换单
    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowLeft" });
    await findPaneShowing("WO100001");
    expect(screen.getByRole("button", { name: "上一条工单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一条工单" }));
    await findPaneShowing("WO100002");
  });
});
