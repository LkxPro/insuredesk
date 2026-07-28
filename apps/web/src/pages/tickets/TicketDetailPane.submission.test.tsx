import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { categoryOptions, channelOptions, detailPayload, listItem } from "./detail-pane-fixtures";

/**
 * 工单原文对照测试：外部件（source=external_channel，携带 submissionText）在
 * 分栏详情中的原文呈现随模式切换 —— 只读态折叠块（左栏客户信息下方，默认收起），
 * 编辑态右栏自动从时间线切换为原文对照，退出编辑切回时间线；非外部件编辑态右栏
 * 保持时间线不动。覆盖 issue #166 的三个验收分支。
 */

// Radix Select 用 jsdom 未实现的 pointer-capture / scroll API 驱动下拉
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});

const details: Record<string, Record<string, unknown>> = {
  t1: detailPayload({
    id: "t1",
    workOrderNumber: "WO100001",
    source: "external_channel",
    submissionText: "客户通过外部渠道提交的工单原文内容，包含详细的问题描述和联系方式。",
  }),
  t2: detailPayload({
    id: "t2",
    workOrderNumber: "WO100002",
    source: "external_channel",
    submissionText: "外部渠道提交的大段工单原文，需要客服对照原文补全左栏表单字段。",
  }),
  t3: detailPayload({
    id: "t3",
    workOrderNumber: "WO100003",
    source: "manual",
    submissionText: null,
  }),
  t4: detailPayload({
    id: "t4",
    workOrderNumber: "WO100004",
    source: "external_channel",
    submissionText: "",
  }),
};

const rows = [
  listItem({ id: "t1", workOrderNumber: "WO100001" }),
  listItem({ id: "t2", workOrderNumber: "WO100002" }),
  listItem({ id: "t3", workOrderNumber: "WO100003" }),
  listItem({ id: "t4", workOrderNumber: "WO100004" }),
];

function renderAt(path = "/tickets/t1") {
  return renderApp({
    path,
    trpc: {
      "ticket.list": { items: rows, total: rows.length, page: 1, pageSize: 20 },
      "ticket.detail": (input: unknown) => details[(input as { id: string }).id],
      "ticket.edit": () => ({ id: "t1", workOrderNumber: "WO100001", status: "processing" }),
      "channel.options": channelOptions,
      "ticketCategory.options": categoryOptions,
    },
  });
}

async function findPane(workOrderNumber = "WO100001") {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent(workOrderNumber));
  return pane;
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

describe("TicketDetailPane submission text", () => {
  it("外部件只读态：原文为左栏折叠块，默认收起", async () => {
    renderAt("/tickets/t1");
    const pane = await findPane("WO100001");

    // 只读态：右栏显示时间线
    expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();

    // 左栏客户信息区域下方有折叠块
    const collapseButton = within(pane).getByRole("button", { name: /工单原文/ });
    expect(collapseButton).toBeInTheDocument();

    // 默认收起，原文不可见
    expect(screen.queryByText(/客户通过外部渠道提交/)).not.toBeInTheDocument();

    // 点开后显示全文
    fireEvent.click(collapseButton);
    await waitFor(() => {
      expect(screen.getByText(/客户通过外部渠道提交/)).toBeInTheDocument();
    });

    // 再点击收起
    fireEvent.click(collapseButton);
    await waitFor(() => {
      expect(screen.queryByText(/客户通过外部渠道提交/)).not.toBeInTheDocument();
    });
  });

  it("外部件编辑态：右栏自动显示原文，退出编辑恢复时间线", async () => {
    renderAt("/tickets/t2");
    const pane = await findPane("WO100002");

    // 只读态：右栏是时间线
    expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();

    // 点击编辑按钮
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    await waitFor(() => {
      // 编辑态：右栏自动切换为原文对照
      expect(screen.getByRole("heading", { name: "工单原文" })).toBeInTheDocument();
      expect(screen.getByText(/外部渠道提交的大段工单原文/)).toBeInTheDocument();
    });

    // 时间线不可见
    expect(screen.queryByRole("heading", { name: "处理记录" })).not.toBeInTheDocument();

    // 左栏折叠块在编辑态不显示
    expect(within(pane).queryByRole("button", { name: /工单原文/ })).not.toBeInTheDocument();

    // 取消编辑
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      // 退出编辑：右栏恢复时间线
      expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();
    });

    // 原文对照面板不可见
    expect(screen.queryByRole("heading", { name: "工单原文" })).not.toBeInTheDocument();
  });

  it("非外部件编辑态：右栏时间线不变", async () => {
    renderAt("/tickets/t3");
    const pane = await findPane("WO100003");

    // 只读态：右栏是时间线
    expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();

    // 无折叠块（非外部件无原文）
    expect(within(pane).queryByRole("button", { name: /工单原文/ })).not.toBeInTheDocument();

    // 点击编辑按钮
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });

    // 编辑态：右栏保持时间线
    expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();

    // 不显示原文对照
    expect(screen.queryByRole("heading", { name: "工单原文" })).not.toBeInTheDocument();
  });

  it("外部件无原文时与非外部件行为一致", async () => {
    renderAt("/tickets/t4");
    const pane = await findPane("WO100004");

    // 无折叠块
    expect(within(pane).queryByRole("button", { name: /工单原文/ })).not.toBeInTheDocument();

    // 点击编辑
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });

    // 右栏保持时间线（无原文就不切换）
    expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "工单原文" })).not.toBeInTheDocument();
  });
});
