import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部端主页：/external-tickets 是全宽表格一级列表（着陆不自动选中、不跳转），
 * 整行点进 /external-tickets/:id 详情态——左侧窄列 + 右侧详情（两态结构与内部
 * /tickets 同）；新建工单是对话框，提交成功进新单详情。
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
  it("着陆为全宽表格：8 列表头就位，不拉详情不跳转", async () => {
    renderPage();

    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    for (const name of [
      "工单号",
      "反馈时间",
      "用户反馈渠道",
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
            userComplaintChannel: "保司400热线",
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
    expect(within(row).getByText("保司400热线")).toBeInTheDocument();
    expect(within(row).getByText("已联系客户，等待回复")).toBeInTheDocument();
    expect(within(row).getByText("未完结")).toBeInTheDocument();
    expect(within(row).getByText("客服新发言")).toBeInTheDocument();
  });

  it("最新记录是 create（remark 为空）：跟进列留空、无新发言徽标", async () => {
    renderPage();

    const row = (await screen.findByText("WO100001")).closest("tr") as HTMLElement;
    expect(within(row).queryByText("客服新发言")).not.toBeInTheDocument();
    const cells = within(row).getAllByRole("cell");
    // 用户反馈渠道无值落横杠
    expect(cells[2]).toHaveTextContent("—");
    expect(cells[6]).toHaveTextContent("");
  });

  it("整行进详情态：全宽表换成窄列+详情，「返回列表」回到表格", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("处理中"));

    expect(await screen.findByRole("region", { name: "工单详情" })).toBeInTheDocument();
    expect(callsTo("externalTicket.detail")[0]?.input).toEqual({ ticketId: "t1" });
    expect(screen.getByRole("navigation", { name: "工单窄列" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

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

describe("详情态（窄列 + 详情，同内部两态）", () => {
  const twoItems = [
    ticket({ customerName: "张三" }),
    ticket({
      id: "t2",
      workOrderNumber: "WO100002",
      customerName: "李四",
      feedbackTime: null,
    }),
  ];

  function renderDetail(path: string, items = twoItems) {
    return renderPage(path, {
      "externalTicket.list": { items, total: items.length },
      "externalTicket.detail": (input: { ticketId: string }) => ({
        ticket: ticket({
          id: input.ticketId,
          workOrderNumber: input.ticketId === "t2" ? "WO100002" : "WO100001",
        }),
        processLogs: [],
      }),
    });
  }

  it("窄列 = 客户名/状态/反馈时间（无工单号），点行切单并带上 aria-current", async () => {
    renderDetail("/external-tickets/t1");
    await screen.findByRole("region", { name: "工单详情" });

    const narrow = screen.getByRole("navigation", { name: "工单窄列" });
    expect(await within(narrow).findByText("张三")).toBeInTheDocument();
    expect(within(narrow).getByText("李四")).toBeInTheDocument();
    expect(within(narrow).queryByText("WO100001")).not.toBeInTheDocument();
    // 反馈时间格式化出线；无反馈时间的行落 —
    expect(within(narrow).getByText(/2026-07-09/)).toBeInTheDocument();
    expect(within(narrow).getByText("—")).toBeInTheDocument();

    fireEvent.click(within(narrow).getByText("李四"));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100002"),
    );
    expect(within(narrow).getByText("李四").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("详情态筛选收起为摘要、分页退场、副标题让位；展开后筛选器回到位", async () => {
    renderDetail("/external-tickets/t1?status=processing", [
      twoItems[0] as ReturnType<typeof ticket>,
    ]);
    await screen.findByRole("region", { name: "工单详情" });

    expect(await screen.findByText(/共 1 条 · 1 个筛选条件/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();
    expect(screen.queryByText(/第 1 \/ 1 页/)).not.toBeInTheDocument();
    expect(screen.queryByText("客服有新发言的工单排在最前。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开筛选" }));
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "收起筛选" }));
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();
  });

  it("深链 /external-tickets/:id 直接还原详情态", async () => {
    renderDetail("/external-tickets/t2");

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100002"),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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

  it("提交成功后重开：textarea 是空白新单", async () => {
    renderPage("/external-tickets", {
      "externalTicket.submit": { id: "t9", workOrderNumber: "WO100009" },
      "externalTicket.detail": detailPayload("t9"),
    });
    const box = await openDialog();

    fireEvent.change(box, { target: { value: "客户要求退保" } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("工单原文")).not.toBeInTheDocument();
    });

    // 成功路径是父组件直接关窗跳详情，不经 onOpenChange——草稿靠 reset-on-open 清
    const reopened = await openDialog();
    expect(reopened).toHaveValue("");
  });

  it("提交失败 → X 关闭 → 重开：无「提交失败」Alert、textarea 空白", async () => {
    renderPage("/external-tickets", {
      "externalTicket.submit": () => {
        throw new Error("原文含有敏感信息");
      },
    });
    const box = await openDialog();

    fireEvent.change(box, { target: { value: "客户电话 13800001111" } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    expect(await screen.findByText("原文含有敏感信息")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("工单原文")).not.toBeInTheDocument();
    });

    const reopened = await openDialog();
    expect(reopened).toHaveValue("");
    expect(screen.queryByText("提交失败")).not.toBeInTheDocument();
  });
});
