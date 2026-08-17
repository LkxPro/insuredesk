import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, renderApp, type TestRole, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { detailPayload, listItem } from "./detail-pane-fixtures";

/**
 * 分栏详情的只读态：左栏渲染全部工单信息（含系统与 SLA 只读字段），右栏渲染
 * ProcessLog 时间线，头部四个操作按钮按权限与状态门控。
 *
 * 门控口径与服务端一致：编辑=ticket.edit（任何状态，含已完结）、分配/改派=
 * ticket.assign、完结=ticket.process 且工单在途、删除=ticket.delete。跟进输入
 * 框走 ticket.process + 在途，与完结同一道门。
 */

function renderDetail(
  overrides: Record<string, unknown> = {},
  role: TestRole = TEST_ROLES.CS_MANAGER,
) {
  auth.user = userWith(role);
  return renderApp({
    path: "/tickets/t1",
    trpc: {
      "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
      "ticket.detail": detailPayload(overrides),
    },
  });
}

async function findPane() {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent("WO100001"));
  return pane;
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

describe("左栏工单信息", () => {
  it("渲染业务字段与系统/SLA 只读字段", async () => {
    renderDetail();
    const pane = await findPane();

    // 业务字段
    expect(within(pane).getByText("王小明")).toBeInTheDocument();
    expect(within(pane).getByText("13800000001")).toBeInTheDocument();
    expect(within(pane).getByText("P2026070900123")).toBeInTheDocument();
    expect(within(pane).getByText("对理赔进度有异议")).toBeInTheDocument();
    expect(within(pane).getByText("理赔投诉")).toBeInTheDocument();
    expect(within(pane).getByText("一般投诉")).toBeInTheDocument();

    // 系统字段：来源与创建人（工单号只在头部，左栏不重复）
    expect(within(pane).getByText("手工录入")).toBeInTheDocument();
    expect(within(pane).getAllByText("测试用户").length).toBeGreaterThan(0);
    expect(within(pane).getByRole("heading", { name: "WO100001" })).toBeInTheDocument();

    // SLA 派生字段：跟进频次与首响要求两态都只读
    expect(within(pane).getByText("24小时内累计跟进1次")).toBeInTheDocument();
    expect(within(pane).getByText("120分钟内完成首次响应")).toBeInTheDocument();
    expect(within(pane).getByText("联系次数")).toBeInTheDocument();
    // 跟进记录的唯一展示面是右栏时间线
    expect(within(pane).queryByText("处理结果")).not.toBeInTheDocument();
  });

  it("未填写字段落到 — ，不是空白", async () => {
    renderDetail({ internalOrderNumber: null, contactId: null });
    const pane = await findPane();

    const orderNumberCell = within(pane).getByText("内部订单号").closest("div");
    expect(orderNumberCell).toHaveTextContent("—");
  });

  it("策略不设时限与未指定策略两种 dueAt 空值分别说明", async () => {
    const noDeadline = renderDetail({ slaPolicyId: "pol-urgent", dueAt: null });
    let pane = await findPane();
    expect(within(pane).getByText("不设时限")).toBeInTheDocument();
    noDeadline.unmount();

    renderDetail({ slaPolicyId: null, slaPolicy: null, dueAt: null });
    pane = await findPane();
    const dueCell = within(pane).getByText("处理时限").closest("div");
    expect(dueCell).toHaveTextContent("—");
  });

  it("完结工单显示完结信息区", async () => {
    renderDetail({
      status: "completed",
      displayStatus: "completed",
      completionTime: "2026-07-10T02:00:00.000Z",
      completionStatus: "正常完结",
    });
    const pane = await findPane();

    expect(within(pane).getByText("完结信息")).toBeInTheDocument();
    expect(within(pane).getByText("正常完结")).toBeInTheDocument();
  });
});

describe("右栏时间线", () => {
  it("渲染 ProcessLog 条目：动作、操作人、备注", async () => {
    renderDetail({
      processLogs: [
        {
          id: "log-1",
          operatorId: "u1",
          operatorName: "测试用户",
          operatorAvatar: null,
          action: "create",
          from: null,
          to: null,
          remark: "客户来电反映理赔慢",
          at: "2026-07-09T02:00:00.000Z",
        },
        {
          id: "log-2",
          operatorId: "u2",
          operatorName: "李客服",
          operatorAvatar: null,
          action: "comment",
          from: null,
          to: null,
          remark: "已致电客户说明进度",
          at: "2026-07-09T05:00:00.000Z",
        },
      ],
    });
    const pane = await findPane();
    const timeline = within(pane).getByRole("list");

    // 动作标签走 PROCESS_LOG_ACTION_LABELS；系统动作（创建）是合并的一行，不展示备注
    expect(within(timeline).getByText(/创建工单/)).toBeInTheDocument();
    expect(within(timeline).queryByText("客户来电反映理赔慢")).not.toBeInTheDocument();
    // 沟通条目（跟进）是气泡：类型徽章 + 操作人 + 备注全文
    expect(within(timeline).getByText("跟进记录")).toBeInTheDocument();
    expect(within(timeline).getByText("已致电客户说明进度")).toBeInTheDocument();
    expect(within(timeline).getByText("李客服")).toBeInTheDocument();
  });

  it("无记录时说明为空，而不是空白区域", async () => {
    renderDetail({ processLogs: [] });
    const pane = await findPane();

    expect(within(pane).getByText("还没有处理记录。")).toBeInTheDocument();
  });
});

describe("头部操作的权限门控", () => {
  it("主管持全套权限：编辑/改派/完结/删除都在（删除属管理员，主管无）", async () => {
    renderDetail();
    await findPane();

    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    // 已分配 → 改派而非分配
    expect(screen.getByRole("button", { name: "改派" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完结工单" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("管理员额外看到删除", async () => {
    renderDetail({}, TEST_ROLES.ADMIN);
    await findPane();

    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("未分配工单的按钮是分配", async () => {
    renderDetail({ assigneeId: null, assigneeName: null, status: "pending" });
    await findPane();

    expect(screen.getByRole("button", { name: "分配" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "改派" })).not.toBeInTheDocument();
  });

  it("已完结工单：完结按钮退场，编辑仍可用", async () => {
    renderDetail({ status: "completed", displayStatus: "completed" });
    await findPane();

    expect(screen.queryByRole("button", { name: "完结工单" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("一线客服无 ticket.edit：编辑按钮不渲染", async () => {
    renderDetail(
      {},
      {
        name: "只读客服",
        permissions: ["ticket.view", "ticket.process"],
      },
    );
    await findPane();

    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "改派" })).not.toBeInTheDocument();
    // ticket.process 在手且在途 → 完结与跟进都在
    expect(screen.getByRole("button", { name: "完结工单" })).toBeInTheDocument();
    expect(screen.getByLabelText("跟进备注")).toBeInTheDocument();
  });
});

describe("二级弹窗复用", () => {
  it("完结按钮打开既有完结弹窗，详情区留在背景", async () => {
    renderDetail();
    await findPane();

    fireEvent.click(screen.getByRole("button", { name: "完结工单" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("完结工单");
    // 处理现场还在背景里（Radix 把它 aria-hidden 掉了，故按 label 而非 role 查）
    expect(document.querySelector('[aria-label="工单详情"]')).toBeInTheDocument();
  });

  it("改派按钮打开既有分配弹窗", async () => {
    renderDetail();
    await findPane();

    fireEvent.click(screen.getByRole("button", { name: "改派" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("改派");
  });

  it("删除按钮打开既有删除确认弹窗", async () => {
    renderDetail({}, TEST_ROLES.ADMIN);
    await findPane();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("删除工单");
  });
});
