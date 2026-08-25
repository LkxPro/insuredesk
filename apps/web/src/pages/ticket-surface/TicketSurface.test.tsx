import type { TicketDisplayStatus } from "@insuredesk/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { DetailPaneShell } from "./DetailPaneShell";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { TicketListSearch } from "./TicketListSearch";
import {
  type SurfaceColumn,
  type SurfaceCtx,
  type SurfaceDetailProps,
  type SurfaceListSlice,
  TicketSurface,
} from "./TicketSurface";

type TestItem = {
  id: string;
  workOrderNumber: string;
  customerName: string | null;
  status: string;
  displayStatus: TicketDisplayStatus;
  time: string | null;
};

type TestQuery = {
  status?: string[] | undefined;
  search?: string | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
  page: number;
  pageSize: number;
};

function parseTestQuery(params: URLSearchParams): TestQuery {
  const status = params.get("status")?.split(",").filter(Boolean);
  const rawOrder = params.get("sortOrder");
  return {
    status: status?.length ? status : undefined,
    search: params.get("q") ?? undefined,
    sortBy: params.get("sortBy") ?? undefined,
    sortOrder: rawOrder === "asc" || rawOrder === "desc" ? rawOrder : undefined,
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: 20,
  };
}

function item(overrides: Partial<TestItem> = {}): TestItem {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    customerName: "王小明",
    status: "processing",
    displayStatus: "processing",
    time: "2026-07-11T02:00:00.000Z",
    ...overrides,
  };
}

const rows = [
  item({ id: "t1", workOrderNumber: "WO100001", customerName: "王小明" }),
  item({
    id: "t2",
    workOrderNumber: "WO100002",
    customerName: "李大华",
    displayStatus: "overdue",
    time: "2026-07-01T02:00:00.000Z",
  }),
  item({ id: "t3", workOrderNumber: "WO100003", customerName: "张三" }),
];

const store = {
  pages: {} as Record<number, TestItem[]>,
  total: 0,
  error: null as string | null,
  loading: false,
};

const listInputs: TestQuery[] = [];

function useTestList(query: TestQuery): SurfaceListSlice<TestItem> {
  listInputs.push(query);
  return {
    items: store.pages[query.page] ?? [],
    total: store.total,
    isLoading: store.loading,
    isPlaceholderData: false,
    error: store.error === null ? null : { message: store.error },
  };
}

const columns: ReadonlyArray<SurfaceColumn<TestItem, TestQuery>> = [
  {
    key: "workOrderNumber",
    header: "工单号",
    render: (ticket, ctx) => (
      <Link
        to={ctx.ticketPath(ticket.id)}
        className="font-medium hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {ticket.workOrderNumber}
      </Link>
    ),
  },
  {
    key: "customerName",
    header: "客户姓名",
    render: (ticket) => ticket.customerName,
  },
  {
    key: "createdAt",
    header: "创建时间",
    sort: { field: "createdAt", initialOrder: "desc" },
    render: () => "创建时间值",
  },
  {
    key: "dueAt",
    header: "处理时限",
    sort: { field: "dueAt", initialOrder: "asc" },
    render: () => "处理时限值",
  },
];

const selection = {
  selectable: (ticket: TestItem) => ticket.status !== "completed",
  rowLabel: (ticket: TestItem) => `选择工单 ${ticket.workOrderNumber}`,
  pageLabel: "选择本页全部工单",
  bar: (selected: ReadonlyMap<string, TestItem>, ctx: SurfaceCtx<TestItem, TestQuery>) => (
    <>
      <span>已选 {selected.size} 个工单</span>
      <button type="button" onClick={ctx.clearSelection}>
        清除选择
      </button>
    </>
  ),
};

function TestDetailPane({ ticketId, nav, onSwitch, onCrossPage, onClose }: SurfaceDetailProps) {
  return (
    <DetailPaneShell
      focusKey={ticketId}
      nav={nav}
      onStep={(step) =>
        step.kind === "switch" ? onSwitch(step.ticketId) : onCrossPage(step.direction)
      }
      title={`详情 ${ticketId}`}
      trailing={
        <button type="button" aria-label="关闭详情" onClick={onClose}>
          ×
        </button>
      }
    >
      <div>详情体 {ticketId}</div>
    </DetailPaneShell>
  );
}

function TestSurface({
  withSelection = false,
  headerActions,
  dialogs,
}: {
  withSelection?: boolean;
  headerActions?: (ctx: SurfaceCtx<TestItem, TestQuery>) => ReactNode;
  dialogs?: (ctx: SurfaceCtx<TestItem, TestQuery>) => ReactNode;
}) {
  return (
    <TicketSurface
      basePath="/surface"
      parseQuery={parseTestQuery}
      useList={useTestList}
      title="测试工单"
      subtitle="测试副标题。"
      headerActions={headerActions}
      filters={(ctx) => (
        <>
          <MultiSelectFilter
            label="状态"
            values={ctx.query.status ?? []}
            options={[
              { value: "processing", label: "处理中" },
              { value: "completed", label: "已完结" },
            ]}
            onChange={(values) =>
              ctx.setParam("status", values.length > 0 ? values.join(",") : null)
            }
          />
          <TicketListSearch
            draft={ctx.searchDraft}
            onDraftChange={ctx.setSearchDraft}
            onSubmit={ctx.submitSearch}
            onClear={ctx.clearSearch}
            placeholder="搜索"
          />
        </>
      )}
      activeFilterCount={(query) =>
        [query.status?.length ?? 0, query.search ? 1 : 0].filter((count) => count > 0).length
      }
      columns={columns}
      emptyState={{
        icon: <span data-testid="empty-icon" />,
        title: "暂无匹配的工单",
        description: (query) => (query.search ? "换个条件试试。" : "新建一条工单。"),
      }}
      narrowItem={(ticket) => ({
        id: ticket.id,
        customerName: ticket.customerName,
        status: ticket.displayStatus,
        time: ticket.time,
        overdue: ticket.displayStatus === "overdue",
      })}
      renderDetail={(props) => <TestDetailPane {...props} />}
      selection={withSelection ? selection : undefined}
      dialogs={dialogs}
    />
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderSurface(
  path: string,
  options: Parameters<typeof TestSurface>[0] = {},
): ReturnType<typeof render> {
  const element = (
    <>
      <TestSurface {...options} />
      <LocationProbe />
    </>
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/surface" element={element} />
        <Route path="/surface/:id" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

function locationText() {
  return screen.getByTestId("location").textContent;
}

async function findPaneShowing(title: string) {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent(title));
  return pane;
}

beforeEach(() => {
  store.pages = { 1: rows };
  store.total = rows.length;
  store.error = null;
  store.loading = false;
  listInputs.length = 0;
});

describe("三态骨架", () => {
  it("列表态：全宽表格 + 筛选器 + 分页就位，详情区不在", async () => {
    renderSurface("/surface");

    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态" })).toBeInTheDocument();
    expect(screen.getByText(/共 3 条 · 第 1 \/ 1 页/)).toBeInTheDocument();
    expect(screen.getByText("测试副标题。")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
  });

  it("点行进入处理态：全宽表退场，窄列 + 详情区就位，副标题让位", async () => {
    renderSurface("/surface");
    fireEvent.click(await screen.findByText("WO100002"));

    await findPaneShowing("详情 t2");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工单窄列" })).toBeInTheDocument();
    expect(screen.queryByText("测试副标题。")).not.toBeInTheDocument();
    expect(screen.queryByText(/第 1 \/ 1 页/)).not.toBeInTheDocument();
    expect(locationText()).toBe("/surface/t2");
  });

  it("关闭详情回全宽表，筛选原样保留", async () => {
    renderSurface("/surface?status=processing");
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");

    fireEvent.click(await screen.findByText("WO100001"));
    await findPaneShowing("详情 t1");

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");
    expect(locationText()).toBe("/surface?status=processing");
  });

  it("深链 /surface/:id 直接还原处理态", async () => {
    renderSurface("/surface/t3");

    await findPaneShowing("详情 t3");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("加载失败：错误 Alert 取代表格与分页", async () => {
    store.error = "boom";
    renderSurface("/surface");

    expect(await screen.findByText("工单列表加载失败")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/共 0 条/)).not.toBeInTheDocument();
  });

  it("空结果：空态标题与按查询派生的描述", async () => {
    store.pages = { 1: [] };
    store.total = 0;
    renderSurface("/surface");

    expect(await screen.findByText("暂无匹配的工单")).toBeInTheDocument();
    expect(screen.getByText("新建一条工单。")).toBeInTheDocument();
  });

  it("空结果 + 筛选在生效：描述随查询切换", async () => {
    store.pages = { 1: [] };
    store.total = 0;
    renderSurface("/surface?q=张三");

    expect(await screen.findByText("暂无匹配的工单")).toBeInTheDocument();
    expect(screen.getByText("换个条件试试。")).toBeInTheDocument();
  });
});

describe("窄列", () => {
  it("只显示客户名/状态/时间，不显示工单号；超时行时间红字", async () => {
    renderSurface("/surface/t1");
    await findPaneShowing("详情 t1");

    const narrow = screen.getByRole("navigation", { name: "工单窄列" });
    expect(within(narrow).getByText("王小明")).toBeInTheDocument();
    expect(within(narrow).getByText("李大华")).toBeInTheDocument();
    expect(within(narrow).getByText("张三")).toBeInTheDocument();
    expect(within(narrow).queryByText("WO100001")).not.toBeInTheDocument();

    const overdueRow = within(narrow).getByText("李大华").closest("button");
    expect(within(overdueRow as HTMLElement).getByText(/2026/)).toHaveClass("text-destructive");
    const normalRow = within(narrow).getByText("王小明").closest("button");
    expect(within(normalRow as HTMLElement).getByText(/2026/)).not.toHaveClass("text-destructive");
  });

  it("点窄列行切单，选中行有 aria-current，筛选串随车带走", async () => {
    renderSurface("/surface/t1?status=processing");
    await findPaneShowing("详情 t1");

    const narrow = screen.getByRole("navigation", { name: "工单窄列" });
    expect(within(narrow).getByText("王小明").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.click(within(narrow).getByText("张三"));

    await findPaneShowing("详情 t3");
    expect(within(narrow).getByText("张三").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(locationText()).toBe("/surface/t3?status=processing");
  });
});

describe("翻单契约", () => {
  it("↑/↓ 按列表顺序走前后单，原位换内容；筛选串一路随车", async () => {
    renderSurface("/surface/t2?status=processing");
    const pane = await findPaneShowing("详情 t2");

    fireEvent.keyDown(pane, { key: "ArrowDown" });
    await findPaneShowing("详情 t3");

    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowUp" });
    await findPaneShowing("详情 t2");
    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowUp" });
    await findPaneShowing("详情 t1");

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(locationText()).toBe("/surface?status=processing");
  });

  it("首行 ↑ 与末行 ↓ 都不动作 —— 不翻页、不报错", async () => {
    const first = renderSurface("/surface/t1");
    const atFirst = await findPaneShowing("详情 t1");
    fireEvent.keyDown(atFirst, { key: "ArrowUp" });
    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("详情 t1");
    first.unmount();

    renderSurface("/surface/t3");
    const atLast = await findPaneShowing("详情 t3");
    fireEvent.keyDown(atLast, { key: "ArrowDown" });
    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("详情 t3");
    expect(listInputs.every((input) => input.page === 1)).toBe(true);
  });

  it("←/→ 与 ↑/↓ 同向；prev/next 按钮同一逻辑", async () => {
    renderSurface("/surface/t2");
    const pane = await findPaneShowing("详情 t2");

    fireEvent.keyDown(pane, { key: "ArrowRight" });
    await findPaneShowing("详情 t3");
    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowLeft" });
    await findPaneShowing("详情 t2");

    fireEvent.click(screen.getByRole("button", { name: "上一条工单" }));
    await findPaneShowing("详情 t1");
    expect(screen.getByRole("button", { name: "上一条工单" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一条工单" }));
    await findPaneShowing("详情 t2");
  });
});

describe("跨页翻单", () => {
  function renderPagedAt(path: string) {
    store.pages = { 1: rows.slice(0, 2), 2: rows.slice(2) };
    store.total = 21;
    return renderSurface(path);
  }

  it("页 1 末行 ↓ 翻到页 2 选中第一条；URL 页码同步，关闭详情停在新页", async () => {
    renderPagedAt("/surface/t2");
    const pane = await findPaneShowing("详情 t2");

    fireEvent.keyDown(pane, { key: "ArrowDown" });

    await findPaneShowing("详情 t3");
    expect(locationText()).toBe("/surface/t3?page=2");
    expect(listInputs.some((input) => input.page === 2)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("WO100003")).toBeInTheDocument();
  });

  it("页 2 首行 ↑ 翻回页 1 选中最后一条", async () => {
    renderPagedAt("/surface/t3?page=2");
    const pane = await findPaneShowing("详情 t3");

    fireEvent.keyDown(pane, { key: "ArrowUp" });

    await findPaneShowing("详情 t2");
    // setParam 写值不删值：回到第 1 页留下显式 ?page=1，与列表翻页同口径
    expect(locationText()).toBe("/surface/t2?page=1");
  });

  it("深链单不在当前页切片：方向键与按钮都死停，不翻页", async () => {
    renderPagedAt("/surface/t3");
    const pane = await findPaneShowing("详情 t3");

    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "ArrowRight" });

    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("详情 t3");
    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一条工单" })).toBeDisabled();
    expect(listInputs.every((input) => input.page === 1)).toBe(true);
  });

  it("末行 → 越界翻到下一页第一条；页 2 上一条按钮越界翻回", async () => {
    renderPagedAt("/surface/t2?page=1");
    const pane = await findPaneShowing("详情 t2");

    fireEvent.keyDown(pane, { key: "ArrowRight" });
    await findPaneShowing("详情 t3");

    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一条工单" }));
    await findPaneShowing("详情 t2");
  });
});

describe("筛选折叠（处理态）", () => {
  it("默认收起为摘要，展开后筛选器回到位，再收起", async () => {
    renderSurface("/surface/t1?status=processing");
    await findPaneShowing("详情 t1");

    expect(screen.getByText(/共 3 条 · 1 个筛选条件/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开筛选" }));
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "收起筛选" }));
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();
  });

  it("无筛选时摘要显示未筛选", async () => {
    renderSurface("/surface/t1");
    await findPaneShowing("详情 t1");

    expect(screen.getByText(/共 3 条 · 未筛选/)).toBeInTheDocument();
  });
});

describe("URL 筛选态", () => {
  it("深链查询串进入 useList 入参", async () => {
    renderSurface("/surface?status=processing&q=三丰&page=1");

    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ status: ["processing"], search: "三丰", page: 1 });
  });

  it("勾选筛选项写 URL 并重置页码", async () => {
    store.pages = { 1: rows, 2: rows.slice(2) };
    store.total = 21;
    renderSurface("/surface?status=processing&page=1");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ page: 2 }));
    expect(locationText()).toContain("page=2");

    fireEvent.click(screen.getByRole("button", { name: "状态" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "已完结" }));

    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ status: ["processing", "completed"], page: 1 }),
    );
    expect(locationText()).toBe("/surface?status=processing%2Ccompleted");
  });

  it("清空筛选 = 参数移除，入参不过滤", async () => {
    renderSurface("/surface?status=processing");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "状态" }));
    fireEvent.click(await screen.findByRole("button", { name: "清空" }));

    await waitFor(() => expect(listInputs.at(-1)?.status).toBeUndefined());
    expect(locationText()).toBe("/surface");
  });

  it("搜索草稿提交才落入 URL 与入参", async () => {
    renderSurface("/surface");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    const searchBox = screen.getByRole("searchbox");
    fireEvent.change(searchBox, { target: { value: "三丰" } });
    expect(listInputs.at(-1)?.search).toBeUndefined();

    fireEvent.submit(searchBox.closest("form") as HTMLFormElement);
    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ search: "三丰" }));
    expect(locationText()).toBe("/surface?q=%E4%B8%89%E4%B8%B0");
  });

  it("点「搜索」按钮与回车等效提交", async () => {
    renderSurface("/surface");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "三丰" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ search: "三丰" }));
    expect(locationText()).toBe("/surface?q=%E4%B8%89%E4%B8%B0");
  });

  it("清除钮一键撤掉草稿与已提交的搜索", async () => {
    renderSurface("/surface");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    expect(screen.queryByRole("button", { name: "清除搜索" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "三丰" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(locationText()).toBe("/surface?q=%E4%B8%89%E4%B8%B0"));

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    await waitFor(() => expect(locationText()).toBe("/surface"));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(listInputs.at(-1)?.search).toBeUndefined();
  });

  it("排序表头：首击用列定义的初始方向，再击翻转", async () => {
    renderSurface("/surface");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "创建时间" }));
    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ sortBy: "createdAt", sortOrder: "desc" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建时间" }));
    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ sortBy: "createdAt", sortOrder: "asc" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "处理时限" }));
    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ sortBy: "dueAt", sortOrder: "asc" }),
    );
    expect(locationText()).toBe("/surface?sortBy=dueAt&sortOrder=asc");
  });

  it("深链排序态落入入参，再击翻转", async () => {
    renderSurface("/surface?sortBy=dueAt&sortOrder=desc");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ sortBy: "dueAt", sortOrder: "desc" });

    fireEvent.click(screen.getByRole("button", { name: "处理时限" }));
    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ sortBy: "dueAt", sortOrder: "asc" }),
    );
  });

  it("分页：下一页/上一页驱动入参页码", async () => {
    store.pages = { 1: rows, 2: rows.slice(2) };
    store.total = 21;
    renderSurface("/surface");
    await screen.findByText("WO100001");
    expect(screen.getByText(/共 21 条 · 第 1 \/ 2 页/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ page: 2 }));

    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ page: 1 }));
  });
});

describe("selection（可选）", () => {
  it("无 selection 配置：无勾选列", async () => {
    renderSurface("/surface");
    await screen.findByText("WO100001");

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("勾选行进选中条；不可选行禁用；清除选择归零", async () => {
    store.pages = {
      1: [
        ...rows,
        item({
          id: "t4",
          workOrderNumber: "WO100004",
          customerName: "陈完结",
          status: "completed",
          displayStatus: "completed",
        }),
      ],
    };
    store.total = 4;
    renderSurface("/surface", { withSelection: true });
    await screen.findByText("WO100001");

    expect(screen.getByRole("checkbox", { name: "选择工单 WO100004" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100002" }));
    expect(screen.getByText("已选 2 个工单")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    expect(screen.queryByText(/已选 \d+ 个工单/)).not.toBeInTheDocument();
  });

  it("全选本页跳过不可选行", async () => {
    store.pages = {
      1: [
        rows[0] as TestItem,
        item({
          id: "t4",
          workOrderNumber: "WO100004",
          customerName: "陈完结",
          status: "completed",
          displayStatus: "completed",
        }),
      ],
    };
    store.total = 2;
    renderSurface("/surface", { withSelection: true });
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择本页全部工单" }));
    expect(screen.getByText("已选 1 个工单")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择工单 WO100001" })).toBeChecked();
  });

  it("处理态选中条退场，回列表选中不丢", async () => {
    renderSurface("/surface", { withSelection: true });
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    expect(screen.getByText("已选 1 个工单")).toBeInTheDocument();

    fireEvent.click(screen.getByText("WO100001"));
    await findPaneShowing("详情 t1");
    expect(screen.queryByText(/已选 \d+ 个工单/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText("已选 1 个工单")).toBeInTheDocument();
  });
});

describe("槽位注入", () => {
  it("headerActions 与 dialogs 槽收到查询上下文", async () => {
    renderSurface("/surface?q=三丰", {
      headerActions: (ctx) => <span>动作区:{ctx.query.search ?? "无"}</span>,
      dialogs: () => <div>对话框槽</div>,
    });

    expect(await screen.findByText("动作区:三丰")).toBeInTheDocument();
    expect(screen.getByText("对话框槽")).toBeInTheDocument();
  });
});
