import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * List page: rows render from ticket.list with the computed display status,
 * URL filters reach the query input (deep-linkable like /tickets/new), and
 * search / sort / pagination re-query with the right input.
 */

type ListItem = {
  id: string;
  workOrderNumber: string;
  createdAt: string;
  source: string;
  channel: string;
  category: string;
  complaintLevel: string;
  customerName: string;
  policyNumbers: string[];
  status: string;
  displayStatus: string;
  assigneeName: string | null;
  dueAt: string | null;
};

function listItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "投诉-保费收取问题",
    complaintLevel: "一般投诉",
    customerName: "王小明",
    policyNumbers: ["P2026070900123"],
    status: "processing",
    displayStatus: "processing",
    assigneeName: "李客服",
    dueAt: "2026-07-11T02:00:00.000Z",
    ...overrides,
  };
}

// Per-test canned list payload behind ticket.list.
const canned = { items: [] as ListItem[], total: 0 };

function renderAt(path: string) {
  return renderApp({
    path,
    trpc: {
      "channel.filterOptions": [
        { id: "ch-baosi", name: "保司", active: true },
        { id: "ch-pay", name: "支付", active: true },
        { id: "ch-legacy", name: "旧渠道", active: false },
      ],
      "ticketCategory.filterOptions": [
        { id: "cat-claims", name: "理赔咨询", active: true },
        { id: "cat-legacy", name: "旧类别", active: false },
      ],
      "completionStatus.filterOptions": [
        { id: "cs-normal", name: "正常完结", active: true },
        { id: "cs-legacy", name: "旧完结状态", active: false },
      ],
      "ticket.list": (input: unknown) => {
        const page =
          ((input as Record<string, unknown> | undefined)?.page as number | undefined) ?? 1;
        return { items: canned.items, total: canned.total, page, pageSize: 20 };
      },
    },
  });
}

/** Every decoded ticket.list input, in call order. */
function listInputs(): Array<Record<string, unknown>> {
  return callsTo("ticket.list").map((call) => call.input as Record<string, unknown>);
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  canned.items = [];
  canned.total = 0;
});

describe("list rendering", () => {
  it("renders one row per ticket with the computed display status", async () => {
    canned.items = [
      listItem(),
      listItem({
        id: "t2",
        workOrderNumber: "WO100002",
        customerName: "赵一超",
        status: "assigned",
        displayStatus: "overdue",
        assigneeName: null,
      }),
    ];
    canned.total = 2;

    renderAt("/tickets");

    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    expect(screen.getByText("WO100002")).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();
    // The overdue row shows the computed status, not the stored one
    expect(screen.getByText("已超时")).toBeInTheDocument();
    expect(screen.queryByText("已分配")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    renderAt("/tickets");
    expect(await screen.findByText("暂无匹配的工单")).toBeInTheDocument();
  });
});

describe("保单号列: 首个 + N 徽标", () => {
  it("单保单号原样展示，无徽标", async () => {
    canned.items = [listItem({ policyNumbers: ["P-ONLY-001"] })];
    canned.total = 1;
    renderAt("/tickets");

    expect(await screen.findByText("P-ONLY-001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /还有.*个保单号/ })).not.toBeInTheDocument();
  });

  it("空数组沿用未填写占位，不展示徽标", async () => {
    canned.items = [listItem({ policyNumbers: [] })];
    canned.total = 1;
    renderAt("/tickets");

    await screen.findByText("WO100001");
    const row = screen.getByText("WO100001").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /还有.*个保单号/ })).not.toBeInTheDocument();
  });

  it("多保单号只显首个 + N 徽标，点徽标弹出全部", async () => {
    canned.items = [listItem({ policyNumbers: ["P-FIRST-001", "P-SECOND-002", "P-THIRD-003"] })];
    canned.total = 1;
    renderAt("/tickets");

    // 列内只有首个保单号，其余不撑爆列宽
    expect(await screen.findByText("P-FIRST-001")).toBeInTheDocument();
    expect(screen.queryByText("P-SECOND-002")).not.toBeInTheDocument();

    // 徽标计的是"还剩几个"，非总数
    const badge = screen.getByRole("button", { name: "还有 2 个保单号" });
    expect(badge).toHaveTextContent("+2");

    // 点开 popover 见全部保单号（含首个）
    fireEvent.click(badge);
    const popover = await screen.findByRole("dialog");
    expect(within(popover).getByText("P-FIRST-001")).toBeInTheDocument();
    expect(within(popover).getByText("P-SECOND-002")).toBeInTheDocument();
    expect(within(popover).getByText("P-THIRD-003")).toBeInTheDocument();
  });

  it("点徽标展开保单号不连带打开行详情", async () => {
    canned.items = [listItem({ policyNumbers: ["P-A-1", "P-B-2"] })];
    canned.total = 1;
    renderAt("/tickets");

    fireEvent.click(await screen.findByRole("button", { name: "还有 1 个保单号" }));
    await screen.findByRole("dialog");
    // 只应弹出 popover 一个 dialog；若冒泡到行 onClick，详情弹窗会是第二个
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("URL-driven filters (deep-linkable)", () => {
  it("passes status/channel from the query string into ticket.list", async () => {
    renderAt("/tickets?status=overdue&channel=ch-pay");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ status: ["overdue"], channelId: ["ch-pay"] });
  });

  it("逗号分隔的多值参数解析为数组", async () => {
    renderAt("/tickets?status=overdue,completed&level=一般投诉,高级投诉");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({
      status: ["overdue", "completed"],
      complaintLevel: ["一般投诉", "高级投诉"],
    });
  });

  it("类别筛选：查询串带 category id，入参落到 categoryId，触发器挂计数徽标", async () => {
    renderAt("/tickets?category=cat-claims");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ categoryId: ["cat-claims"] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "类别" })).toHaveTextContent("1"),
    );
  });

  // 三个目录的筛选器共用同一渲染惯用法 (active ? name : `${name}（已停用）`);
  // 停用项为何仍在筛选 feed 里、按停用 id 为何还能筛到存量工单, 是服务端规则。
  it.each([
    {
      param: "channel",
      id: "ch-legacy",
      inputKey: "channelId",
      label: "渠道",
      name: "旧渠道（已停用）",
    },
    {
      param: "category",
      id: "cat-legacy",
      inputKey: "categoryId",
      label: "类别",
      name: "旧类别（已停用）",
    },
    {
      param: "completionStatus",
      id: "cs-legacy",
      inputKey: "completionStatusId",
      label: "完结状态",
      name: "旧完结状态（已停用）",
    },
  ])("按停用$label筛选：查询带其 id，弹层选项带（已停用）标注且已勾选", async (row) => {
    renderAt(`/tickets?${row.param}=${row.id}`);

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ [row.inputKey]: [row.id] });

    fireEvent.click(screen.getByRole("button", { name: row.label }));
    const option = await screen.findByRole("checkbox", { name: row.name });
    expect(option).toBeChecked();
  });

  it("ignores an invalid query string and lists with defaults", async () => {
    renderAt("/tickets?status=nonsense&page=x");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]?.status).toBeUndefined();
    expect(listInputs()[0]).toMatchObject({ page: 1 });
  });

  it("keeps valid filters when a neighbouring param is malformed", async () => {
    renderAt("/tickets?status=overdue&page=x");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ status: ["overdue"], page: 1 });
  });
});

describe("归档工单默认隐藏（来源缺省）", () => {
  it("无 source 参数时 ticket.list 入参缺省排除 file_import", async () => {
    renderAt("/tickets");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]?.source).toEqual(["feishu_form", "manual", "community"]);
    // 来源触发器常驻显示缺省计数（3 = 排除归档单后的选中数）
    expect(screen.getByRole("button", { name: "来源" })).toHaveTextContent("3");
  });

  it("清空来源 → 空值参数下传，服务端按不过滤处理", async () => {
    renderAt("/tickets");

    fireEvent.click(screen.getByRole("button", { name: "来源" }));
    fireEvent.click(await screen.findByRole("button", { name: "清空" }));

    await waitFor(() => expect(listInputs().at(-1)?.source).toEqual([]));
  });

  it("勾选文件导入后归档单进入筛选集", async () => {
    renderAt("/tickets");

    fireEvent.click(screen.getByRole("button", { name: "来源" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "文件导入" }));

    await waitFor(() =>
      expect(listInputs().at(-1)?.source).toEqual([
        "feishu_form",
        "manual",
        "community",
        "file_import",
      ]),
    );
  });
});

describe("多选交互与 URL 序列化", () => {
  /** 勾选项后在最新一次 ticket.list 入参上断言。 */
  async function toggleOption(filterLabel: string, optionName: string) {
    fireEvent.click(screen.getByRole("button", { name: filterLabel }));
    fireEvent.click(await screen.findByRole("checkbox", { name: optionName }));
  }

  it("勾选多个状态 → 数组入参 + 触发器计数徽标", async () => {
    renderAt("/tickets?status=overdue");
    await waitFor(() =>
      expect(listInputs().some((input) => Array.isArray(input.status))).toBe(true),
    );

    // 深链已带一项
    await toggleOption("状态", "已完结");
    await waitFor(() => expect(listInputs().at(-1)?.status).toEqual(["overdue", "completed"]));
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("2");
  });

  it("清空 = 回到全部：参数移除，入参不过滤", async () => {
    renderAt("/tickets?status=overdue,completed");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "状态" }));
    fireEvent.click(await screen.findByRole("button", { name: "清空" }));

    await waitFor(() => expect(listInputs().at(-1)?.status).toBeUndefined());
    expect(screen.getByRole("button", { name: "状态" })).not.toHaveTextContent(/\d/);
  });

  it("全选写入完整选项集", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "投诉等级" }));
    fireEvent.click(await screen.findByRole("button", { name: "全选" }));

    await waitFor(() =>
      expect(listInputs().at(-1)?.complaintLevel).toEqual([
        "一般投诉",
        "高级投诉",
        "加急投诉",
        "特急投诉",
      ]),
    );
  });

  it("再次点击已勾选项取消选择", async () => {
    renderAt("/tickets?level=一般投诉");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    await toggleOption("投诉等级", "一般投诉");
    await waitFor(() => expect(listInputs().at(-1)?.complaintLevel).toBeUndefined());
  });

  it("筛选变更后 URL 落在地址栏（深链可分享），并重置页码", async () => {
    renderAt("/tickets?status=overdue&page=2");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    await toggleOption("状态", "已完结");

    await waitFor(() => expect(listInputs().at(-1)?.status).toEqual(["overdue", "completed"]));
    expect(listInputs().at(-1)).toMatchObject({ page: 1 });
  });
});

describe("search / sort / pagination re-query", () => {
  it("submitting the search box queries with the entered text", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));

    const searchBox = screen.getByRole("searchbox");
    fireEvent.change(searchBox, { target: { value: "三丰" } });
    fireEvent.submit(searchBox.closest("form") as HTMLFormElement);

    await waitFor(() => expect(listInputs().at(-1)).toMatchObject({ search: "三丰" }));
  });

  it("clicking 创建时间 flips to ascending; clicking 处理时限 sorts by dueAt soonest-first", async () => {
    canned.items = [listItem()];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: /创建时间/ }));
    await waitFor(() =>
      expect(listInputs().at(-1)).toMatchObject({ sortBy: "createdAt", sortOrder: "asc" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /处理时限/ }));
    await waitFor(() =>
      expect(listInputs().at(-1)).toMatchObject({ sortBy: "dueAt", sortOrder: "asc" }),
    );
  });

  it("下一页 advances the page against the filtered total", async () => {
    canned.items = [listItem()];
    canned.total = 45;
    renderAt("/tickets");
    await screen.findByText("WO100001");
    expect(screen.getByText(/共 45 条/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(listInputs().at(-1)).toMatchObject({ page: 2 }));
  });
});
