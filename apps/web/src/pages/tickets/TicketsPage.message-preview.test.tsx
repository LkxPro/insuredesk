import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

const ticket = {
  id: "ticket-message-1",
  workOrderNumber: "WO100001",
  createdAt: "2026-11-10T02:00:00.000Z",
  source: "manual",
  createdBy: "创建人甲",
  channel: "支付",
  category: null,
  slaPolicyId: "policy-1",
  slaPolicyName: "一般投诉",
  customerName: "客户甲",
  policyNumbers: [],
  status: "processing",
  displayStatus: "processing",
  assigneeId: "agent-1",
  assigneeName: "责任人乙",
  dueAt: "2026-11-12T02:00:00.000Z",
  latestMessage: "客户已确认，等待退款到账",
  latestMessageAction: "external_note",
};

function renderList(
  logs: Array<{ id: string; action: string; remark: string | null }> = [],
  options: {
    items?: Array<Omit<typeof ticket, "latestMessage"> & { latestMessage: string | null }>;
    total?: number;
    detail?: unknown;
  } = {},
) {
  return renderApp({
    path: "/tickets?sortBy=dueAt&sortOrder=asc",
    trpc: {
      "ticket.list": {
        items: options.items ?? [ticket],
        total: options.total ?? 1,
        page: 1,
        pageSize: 20,
      },
      "ticket.detail": options.detail ?? {
        processLogs: logs.map((log) => ({
          ...log,
          operatorName: "不显示的发送人",
          at: "2026-11-10T02:00:00Z",
        })),
      },
    },
  });
}

beforeAll(async () => {
  await import("./TicketsPage");
});

beforeEach(() => {
  localStorage.clear();
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

describe("工单列表最新消息", () => {
  it("总开关仅替换末尾三列，关闭恢复，并记住浏览器选择", async () => {
    const view = renderList();
    await screen.findByText(ticket.workOrderNumber);
    const toggle = screen.getByRole("button", { name: "最新消息" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(ticket.latestMessage)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "",
      "工单号",
      "状态",
      "客户姓名",
      "渠道",
      "时效策略",
      "来源",
      "创建人",
      "责任人",
      "最新消息",
    ]);
    expect(within(table).getByText(ticket.latestMessage)).toBeInTheDocument();
    expect(within(table).getByText(ticket.createdBy)).toBeInTheDocument();
    expect(within(table).getByText(ticket.assigneeName)).toBeInTheDocument();
    expect(within(table).getByRole("checkbox", { name: /选择工单/ })).toBeInTheDocument();

    view.unmount();
    renderList();
    await screen.findByText(ticket.latestMessage);
    expect(screen.getByRole("button", { name: "最新消息" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "最新消息" }));
    for (const name of ["创建时间", "处理时限", "操作"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(ticket.latestMessage)).not.toBeInTheDocument();
  });

  it("悬停按需显示全部沟通正文，移入可阅读、离开关闭，隐藏系统记录和元数据", async () => {
    const user = userEvent.setup();
    renderList([
      { id: "m1", action: "comment", remark: "首次联系客户" },
      { id: "m2", action: "internal_note", remark: "内部核实\n确认退款账户" },
      { id: "m3", action: "external_note", remark: ticket.latestMessage },
      { id: "m4", action: "resolve", remark: "不显示的完结备注" },
      { id: "m5", action: "comment", remark: " \n\t" },
    ]);
    await screen.findByText(ticket.workOrderNumber);
    await user.click(screen.getByRole("button", { name: "最新消息" }));
    expect(callsTo("ticket.detail")).toHaveLength(0);
    const trigger = screen.getByRole("link", { name: ticket.latestMessage });
    expect(trigger).toHaveAttribute("href", "/tickets/ticket-message-1?sortBy=dueAt&sortOrder=asc");
    await user.hover(trigger);
    const history = await screen.findByRole("region", { name: "沟通记录" });
    expect(
      within(history)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["首次联系客户", "内部核实\n确认退款账户", ticket.latestMessage]);
    expect(within(history).queryByText("不显示的发送人")).not.toBeInTheDocument();
    expect(within(history).queryByText("不显示的完结备注")).not.toBeInTheDocument();
    expect(within(history).queryByRole("textbox")).not.toBeInTheDocument();
    expect(callsTo("ticket.detail")[0]?.input).toEqual({ id: ticket.id });
    await user.hover(history);
    fireEvent.scroll(history, { target: { scrollTop: 0 } });
    expect(history).toBeInTheDocument();
    await user.unhover(history);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "沟通记录" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("无消息显示横线，不请求历史；只读用户关闭后仍无操作入口", async () => {
    auth.user = userWith(TEST_ROLES.READ_ONLY);
    const user = userEvent.setup();
    renderList([], { items: [{ ...ticket, latestMessage: null }] });
    await screen.findByText(ticket.workOrderNumber);
    await user.click(screen.getByRole("button", { name: "最新消息" }));
    const row = screen.getByRole("row", { name: /WO100001/ });
    const messageCell = within(row).getAllByRole("cell").at(-1);
    expect(messageCell).toHaveTextContent("—");
    if (!messageCell) throw new Error("缺少消息单元格");
    await user.hover(messageCell);
    expect(callsTo("ticket.detail")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "沟通记录" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "最新消息" }));
    expect(screen.getByRole("columnheader", { name: "创建时间" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
  });

  it("翻页保持开关和排序，点击正文进入详情且窄列表不显示预览", async () => {
    renderList([], {
      total: 40,
      detail: () => {
        throw new Error("测试工单详情不可用");
      },
    });
    await screen.findByText(ticket.workOrderNumber);
    fireEvent.click(screen.getByRole("button", { name: "最新消息" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(callsTo("ticket.list").at(-1)?.input).toMatchObject({
        page: 2,
        sortBy: "dueAt",
        sortOrder: "asc",
      }),
    );
    expect(screen.getByRole("button", { name: "最新消息" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("link", { name: ticket.latestMessage }));
    await screen.findByText("测试工单详情不可用");
    expect(screen.queryByRole("button", { name: "最新消息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(ticket.latestMessage)).not.toBeInTheDocument();
  });

  it("历史加载失败时给出错误，重新悬停可重试", async () => {
    let fail = true;
    const user = userEvent.setup();
    renderList([], {
      detail: () => {
        if (fail) throw new Error("读取失败");
        return { processLogs: [{ id: "retry", action: "comment", remark: "重试后完整正文" }] };
      },
    });
    await screen.findByText(ticket.workOrderNumber);
    await user.click(screen.getByRole("button", { name: "最新消息" }));
    const link = screen.getByRole("link", { name: ticket.latestMessage });
    await user.hover(link);
    expect(await screen.findByRole("alert")).toHaveTextContent("沟通记录加载失败");
    await user.unhover(link);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    fail = false;
    await user.hover(link);
    expect(await screen.findByText("重试后完整正文")).toBeInTheDocument();
  });
});
