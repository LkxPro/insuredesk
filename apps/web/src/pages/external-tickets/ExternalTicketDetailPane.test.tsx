import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 右栏详情（对话模型）：头部 → 处理记录时间线 → 留言框；原文与字段卡默认
 * 折叠。时间线内容筛选在服务端，这里验证折叠行为、留言流、已完结只读，
 * 以及窄屏返回键。
 */

const ALL_FIELDS = [
  "workOrderNumber",
  "status",
  "feedbackTime",
  "channelId",
  "categoryId",
  "priority",
  "hasContacted",
  "processingResult",
];

type DetailOverrides = {
  ticket?: Record<string, unknown>;
  visibleFields?: string[];
  processLogs?: unknown[];
};

function detailPayload(overrides: DetailOverrides = {}) {
  const { ticket: ticketOverrides = {}, ...rest } = overrides;
  return {
    ticket: {
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
      ...ticketOverrides,
    },
    visibleFields: ALL_FIELDS,
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
      // 返回键用例会回到无选中的列表：给列表一行可渲染的数据
      "externalTicket.list": {
        items: [
          {
            id: "t1",
            workOrderNumber: "WO100001",
            status: "processing",
            createdAt: "2026-07-09T02:00:00.000Z",
            latestLog: { action: "create", remark: "", at: "2026-07-09T02:00:00.000Z" },
          },
        ],
        total: 1,
        visibleFields: [],
      },
      ...extraTrpc,
    },
  });
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

    // 回到列表路由后详情 query 不再挂在页面上；列表行出现
    expect(await screen.findByRole("navigation", { name: "工单列表" })).toBeInTheDocument();
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

describe("折叠卡", () => {
  it("原文默认折叠，展开后逐字呈现（换行保留）", async () => {
    renderDetail();
    await screen.findByText("处理记录");

    expect(screen.queryByText(/客户反馈保单无法下载/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /工单原文/ }));

    const text = await screen.findByText(/客户反馈保单无法下载/);
    expect(text).toHaveClass("whitespace-pre-wrap");
  });

  it("字段卡默认折叠，展开后只渲染白名单内有值的字段", async () => {
    renderDetail();
    await screen.findByText("处理记录");

    expect(screen.queryByText("微信")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /工单信息/ }));

    // 有值 → 出现（渠道走 JOIN 出的名字，枚举走中文标签，布尔走是/否）
    expect(await screen.findByText("微信")).toBeInTheDocument();
    expect(screen.getByText("高")).toBeInTheDocument();
    expect(screen.getByText("是")).toBeInTheDocument();
    // 白名单内但无值 → 整条不渲染，不留 —
    expect(screen.queryByText("类别")).not.toBeInTheDocument();
    expect(screen.queryByText("最新跟进")).not.toBeInTheDocument();
  });

  it("hides a field the account's whitelist omits even when the value is present", async () => {
    renderDetail({ visibleFields: ["workOrderNumber", "status"] });
    await screen.findByText("处理记录");

    fireEvent.click(screen.getByRole("button", { name: /工单信息/ }));

    expect(screen.queryByText("微信")).not.toBeInTheDocument();
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
