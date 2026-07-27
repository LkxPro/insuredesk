import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部工单详情：原文 + 字段卡片 + 时间线 + 留言。字段卡片只渲染"白名单内且
 * 有值"的字段（一片 — 稀释信息），时间线的内容筛选在服务端，这里验证外部留言
 * 与内部跟进在视觉上可分，以及已完结不再给留言入口。
 */

const ORG = "org-1";

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
    externalOrgId: ORG,
    trpc: { "externalTicket.detail": detailPayload(overrides), ...extraTrpc },
  });
}

describe("原文与字段卡片", () => {
  it("shows the submission text verbatim, newlines preserved", async () => {
    renderDetail();
    const text = await screen.findByText(/客户反馈保单无法下载/);
    expect(text).toHaveClass("whitespace-pre-wrap");
  });

  it("renders only visible fields that have a value", async () => {
    renderDetail();
    await screen.findByText("工单信息");

    // 有值 → 出现（渠道走 JOIN 出的名字，枚举走中文标签，布尔走是/否）
    expect(screen.getByText("微信")).toBeInTheDocument();
    expect(screen.getByText("高")).toBeInTheDocument();
    expect(screen.getByText("是")).toBeInTheDocument();
    // 白名单内但无值 → 整条不渲染，不留 —
    expect(screen.queryByText("类别")).not.toBeInTheDocument();
    expect(screen.queryByText("最新跟进")).not.toBeInTheDocument();
  });

  it("hides a field the org's whitelist omits even when the value is present", async () => {
    renderDetail({ visibleFields: ["workOrderNumber", "status"] });
    await screen.findByText("工单信息");
    expect(screen.queryByText("微信")).not.toBeInTheDocument();
  });

  it("says so when nothing has been filled in yet", async () => {
    // 白名单全开但字段都空：工单号与状态不在卡片里（表头已呈现），故整卡为空
    renderDetail({
      visibleFields: ["feedbackTime", "channelId", "priority", "hasContacted"],
      ticket: { channelName: null, priority: null, hasContacted: null, feedbackTime: null },
    });
    expect(await screen.findByText("客服团队还未补充工单信息。")).toBeInTheDocument();
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
      operatorName: "机构用户",
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
      operatorName: "机构用户",
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
    // 时间线要带上新留言
    await waitFor(() => {
      expect(callsTo("externalTicket.detail").length).toBeGreaterThan(1);
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
