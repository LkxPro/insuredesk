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
    expect(listInputs()[0]).toMatchObject({ status: "overdue", channelId: "ch-pay" });
  });

  it("按停用渠道筛选：查询带其 id，触发器显示（已停用）标注", async () => {
    renderAt("/tickets?channel=ch-legacy");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ channelId: "ch-legacy" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "渠道" })).toHaveTextContent("旧渠道（已停用）"),
    );
  });

  it("按停用完结状态筛选：查询带其 id，触发器显示（已停用）标注", async () => {
    renderAt("/tickets?completionStatus=cs-legacy");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ completionStatusId: "cs-legacy" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "完结状态" })).toHaveTextContent(
        "旧完结状态（已停用）",
      ),
    );
  });

  it("类别筛选：查询串带 category id，入参落到 categoryId", async () => {
    renderAt("/tickets?category=cat-claims");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ categoryId: "cat-claims" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "类别" })).toHaveTextContent("理赔咨询"),
    );
  });

  it("按停用类别筛选：查询带其 id，触发器显示（已停用）标注", async () => {
    renderAt("/tickets?category=cat-legacy");

    await waitFor(() => expect(listInputs().length).toBeGreaterThan(0));
    expect(listInputs()[0]).toMatchObject({ categoryId: "cat-legacy" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "类别" })).toHaveTextContent("旧类别（已停用）"),
    );
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
    expect(listInputs()[0]).toMatchObject({ status: "overdue", page: 1 });
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
