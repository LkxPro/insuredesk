import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { categoryOptions, channelOptions, detailPayload, listItem } from "./detail-pane-fixtures";

/**
 * 两态主从分栏 (issue #164)：/tickets 是全宽表格态，/tickets/:id 是处理态——
 * 列表压缩成左侧窄列（客户名/状态/处理时限，无工单号），右侧渲染详情区。
 *
 * 这里测两态之间的行为：点行进入、关闭回全宽（筛选原样）、窄列内容与超时红字、
 * 深链还原、窄列点击与 ↑/↓ 切单（列表边缘不动作）、压缩态筛选器收起为摘要。
 */

const rows = [
  listItem({ id: "t1", workOrderNumber: "WO100001", customerName: "王小明" }),
  listItem({
    id: "t2",
    workOrderNumber: "WO100002",
    customerName: "李大华",
    displayStatus: "overdue",
    dueAt: "2026-07-01T02:00:00.000Z",
  }),
  listItem({ id: "t3", workOrderNumber: "WO100003", customerName: "张三" }),
];

const details: Record<string, Record<string, unknown>> = {
  t1: detailPayload({ id: "t1", workOrderNumber: "WO100001", customerName: "王小明" }),
  t2: detailPayload({ id: "t2", workOrderNumber: "WO100002", customerName: "李大华" }),
  t3: detailPayload({ id: "t3", workOrderNumber: "WO100003", customerName: "张三" }),
};

function renderAt(path: string) {
  return renderApp({
    path,
    trpc: {
      "ticket.list": (input: unknown) => ({
        items: rows,
        total: rows.length,
        page: ((input as Record<string, unknown>)?.page as number | undefined) ?? 1,
        pageSize: 20,
      }),
      "ticket.detail": (input: unknown) => {
        const { id } = input as { id: string };
        const payload = details[id];
        if (!payload) throw new Error(`Unexpected ticket.detail id: ${id}`);
        return payload;
      },
      "channel.options": channelOptions,
      "ticketCategory.options": categoryOptions,
      "channel.filterOptions": channelOptions,
      "ticketCategory.filterOptions": categoryOptions,
    },
  });
}

/** 详情区，断言已稳定在给定工单号上。 */
async function findPaneShowing(workOrderNumber: string) {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent(workOrderNumber));
  return pane;
}

/** 每次 ticket.detail 请求的 id，按调用顺序。 */
function detailIds() {
  return callsTo("ticket.detail").map((call) => (call.input as { id: string }).id);
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

describe("两态切换", () => {
  it("点行进入处理态：全宽表退场，窄列 + 详情区就位", async () => {
    renderAt("/tickets");

    // 全宽态：表格在，详情区不在
    expect(await screen.findByText("WO100002")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("WO100002"));

    await findPaneShowing("WO100002");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工单窄列" })).toBeInTheDocument();
  });

  it("关闭详情回全宽表，筛选原样保留", async () => {
    renderAt("/tickets?status=overdue");
    await findPaneShowing("WO100001").catch(() => null);

    // 深链前先确认全宽态带着筛选
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");

    fireEvent.click(screen.getByText("WO100001"));
    await findPaneShowing("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
    // 筛选值一路都在 URL 里，回来还带着计数徽标
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");
  });

  it("深链 /tickets/:id 直接还原处理态", async () => {
    renderAt("/tickets/t3");

    await findPaneShowing("WO100003");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("窄列", () => {
  it("只显示客户名/状态/处理时限，不显示工单号；超时行时限红字", async () => {
    renderAt("/tickets/t1");
    await findPaneShowing("WO100001");

    const narrow = screen.getByRole("navigation", { name: "工单窄列" });
    // 三行客户名都在
    expect(within(narrow).getByText("王小明")).toBeInTheDocument();
    expect(within(narrow).getByText("李大华")).toBeInTheDocument();
    expect(within(narrow).getByText("张三")).toBeInTheDocument();
    // 工单号是详情头部的事，窄列不占位
    expect(within(narrow).queryByText("WO100001")).not.toBeInTheDocument();
    expect(within(narrow).queryByText("WO100002")).not.toBeInTheDocument();

    // t2 超时 → 该行时限红字，未超时行不是
    const overdueRow = within(narrow).getByText("李大华").closest("button");
    expect(within(overdueRow as HTMLElement).getByText(/2026/)).toHaveClass("text-destructive");
    const normalRow = within(narrow).getByText("王小明").closest("button");
    expect(within(normalRow as HTMLElement).getByText(/2026/)).not.toHaveClass("text-destructive");
  });

  it("点窄列行切单，选中行有 aria-current", async () => {
    renderAt("/tickets/t1");
    await findPaneShowing("WO100001");

    const narrow = screen.getByRole("navigation", { name: "工单窄列" });
    expect(within(narrow).getByText("王小明").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.click(within(narrow).getByText("张三"));

    await findPaneShowing("WO100003");
    expect(detailIds()).toEqual(["t1", "t3"]);
    expect(within(narrow).getByText("张三").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("↑/↓ 翻单", () => {
  it("按列表顺序走前后单，原位换内容", async () => {
    renderAt("/tickets/t2?status=overdue");
    const pane = await findPaneShowing("WO100002");

    fireEvent.keyDown(pane, { key: "ArrowDown" });
    await findPaneShowing("WO100003");

    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowUp" });
    await findPaneShowing("WO100002");
    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowUp" });
    await findPaneShowing("WO100001");
    expect(detailIds()).toEqual(["t2", "t3", "t2", "t1"]);

    // 翻单一路带着筛选：关闭后落回带筛选的全宽表
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");
  });

  it("首行 ↑ 与末行 ↓ 都不动作 —— 不翻页、不报错", async () => {
    const first = renderAt("/tickets/t1");
    const atFirst = await findPaneShowing("WO100001");
    fireEvent.keyDown(atFirst, { key: "ArrowUp" });
    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100001");
    expect(detailIds()).toEqual(["t1"]);
    first.unmount();

    renderAt("/tickets/t3");
    const atLast = await findPaneShowing("WO100003");
    fireEvent.keyDown(atLast, { key: "ArrowDown" });
    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100003");
    // 从未向服务端要第二页
    const pages = callsTo("ticket.list").map(
      (call) => ((call.input as Record<string, unknown>)?.page as number | undefined) ?? 1,
    );
    expect(pages.every((page) => page === 1)).toBe(true);
  });
});

describe("跨页翻单 (issue #186)", () => {
  // 默认 pageSize=20：total=21 造两页，页 1 给 t1/t2，页 2 只有 t3
  const pagedRows: Record<number, typeof rows> = {
    1: rows.slice(0, 2),
    2: rows.slice(2),
  };

  function renderPagedAt(path: string) {
    return renderApp({
      path,
      trpc: {
        "ticket.list": (input: unknown) => {
          const page = ((input as Record<string, unknown>)?.page as number | undefined) ?? 1;
          return { items: pagedRows[page] ?? [], total: 21, page, pageSize: 20 };
        },
        "ticket.detail": (input: unknown) => {
          const { id } = input as { id: string };
          const payload = details[id];
          if (!payload) throw new Error(`Unexpected ticket.detail id: ${id}`);
          return payload;
        },
        "channel.options": channelOptions,
        "ticketCategory.options": categoryOptions,
        "channel.filterOptions": channelOptions,
        "ticketCategory.filterOptions": categoryOptions,
      },
    });
  }

  function listPages() {
    return callsTo("ticket.list").map(
      (call) => ((call.input as Record<string, unknown>)?.page as number | undefined) ?? 1,
    );
  }

  it("页 1 末行 ↓ 翻到页 2 选中第一条；URL 页码同步，关闭详情停在新页", async () => {
    renderPagedAt("/tickets/t2");
    const pane = await findPaneShowing("WO100002");

    fireEvent.keyDown(pane, { key: "ArrowDown" });

    await findPaneShowing("WO100003");
    expect(listPages()).toContain(2);

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("WO100003")).toBeInTheDocument();
  });

  it("页 2 首行 ↑ 翻回页 1 选中最后一条", async () => {
    renderPagedAt("/tickets/t3?page=2");
    const pane = await findPaneShowing("WO100003");

    fireEvent.keyDown(pane, { key: "ArrowUp" });

    await findPaneShowing("WO100002");
    expect(detailIds()).toEqual(["t3", "t2"]);
  });

  it("深链单不在当前页切片：方向键与按钮都死停，不翻页", async () => {
    renderPagedAt("/tickets/t3");
    const pane = await findPaneShowing("WO100003");

    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "ArrowRight" });

    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100003");
    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一条工单" })).toBeDisabled();
    expect(listPages().every((page) => page === 1)).toBe(true);
  });

  it("←/→ 与 ↑/↓ 同向；prev/next 按钮同一逻辑、越界翻页也可点", async () => {
    renderPagedAt("/tickets/t2?page=1");
    const pane = await findPaneShowing("WO100002");

    // → 越界 = ↓：页 1 末行按 → 翻到页 2 第一条
    fireEvent.keyDown(pane, { key: "ArrowRight" });
    await findPaneShowing("WO100003");

    // 页 2 只有一条：下一条按钮无路可走（末页末行），上一条可点（= ← 越界翻回）
    expect(screen.getByRole("button", { name: "下一条工单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一条工单" }));
    await findPaneShowing("WO100002");

    // 页 1 内：← = ↑ 切片内换单
    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowLeft" });
    await findPaneShowing("WO100001");
    // 页 1 首行：上一条按钮死停（无上一页），下一条可点
    expect(screen.getByRole("button", { name: "上一条工单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一条工单" }));
    await findPaneShowing("WO100002");
  });
});

describe("压缩态的筛选器", () => {
  it("默认收起为摘要，展开后筛选器回到位", async () => {
    renderAt("/tickets/t1?status=overdue");
    await findPaneShowing("WO100001");

    // 收起态：摘要说明有筛选在生效，筛选器本体不占屏
    expect(screen.getByText(/1 个筛选条件/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开筛选" }));

    expect(screen.getByRole("button", { name: "状态" })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "收起筛选" }));
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();
  });
});
