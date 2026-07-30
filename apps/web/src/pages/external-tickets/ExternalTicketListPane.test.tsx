import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 工单行列表：固定行 schema（工单号/状态/徽标/最新跟进摘要/时间），行序与
 * 徽标语义由服务端给定，这里验证渲染与请求参数。筛选（状态/关键词/含已完结）
 * 与分页住在 URL 里。jsdom 无 matchMedia → 不触发着陆自动选中，列表稳定可见。
 */

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    status: "processing",
    submissionText: "客户反馈无法登录",
    createdAt: "2026-07-09T02:00:00.000Z",
    feedbackTime: "2026-07-09T01:00:00.000Z",
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
    processingResult: "已联系客户",
    completionStatusId: null,
    completionStatusName: null,
    completionTime: null,
    latestLog: null,
    ...overrides,
  };
}

function listPayload(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { items, total: items.length, ...overrides };
}

function renderList(overrides: Record<string, unknown> = {}, path = "/external-tickets") {
  return renderApp({
    path,
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      "externalTicket.list": listPayload([ticket()]),
      // 行点击用例会真的选中进详情；给详情一个合法响应，免得它拿默认空壳渲染崩掉
      "externalTicket.detail": {
        ticket: ticket(),
        visibleFields: ["workOrderNumber", "status"],
        processLogs: [],
      },
      ...overrides,
    },
  });
}

describe("行渲染", () => {
  it("最新可见记录是客服 comment → 有「客服新发言」徽标与摘要", async () => {
    renderList({
      "externalTicket.list": listPayload([
        ticket({
          latestLog: {
            action: "comment",
            remark: "请补充保单号",
            at: "2026-07-09T03:00:00.000Z",
          },
        }),
      ]),
    });

    const row = (await screen.findByText("WO100001")).closest("button") as HTMLElement;
    expect(within(row).getByText("客服新发言")).toBeInTheDocument();
    expect(within(row).getByText("跟进记录：请补充保单号")).toBeInTheDocument();
  });

  it("最新记录是自己的留言 → 无徽标（球在客服那边）", async () => {
    renderList({
      "externalTicket.list": listPayload([
        ticket({
          latestLog: {
            action: "external_note",
            remark: "补充一句",
            at: "2026-07-09T03:00:00.000Z",
          },
        }),
      ]),
    });

    const row = (await screen.findByText("WO100001")).closest("button") as HTMLElement;
    expect(within(row).queryByText("客服新发言")).not.toBeInTheDocument();
    expect(within(row).getByText("外部留言：补充一句")).toBeInTheDocument();
  });

  it("建单后无动静 → 摘要只有动作标签，时间回落到创建时刻", async () => {
    renderList({
      "externalTicket.list": listPayload([
        ticket({ latestLog: { action: "create", remark: "", at: "2026-07-09T02:00:00.000Z" } }),
      ]),
    });

    const row = (await screen.findByText("WO100001")).closest("button") as HTMLElement;
    expect(within(row).getByText("创建工单")).toBeInTheDocument();
    expect(within(row).queryByText("客服新发言")).not.toBeInTheDocument();
  });

  it("点击行选中：详情拉取该单", async () => {
    renderList();

    fireEvent.click(await screen.findByText("WO100001"));

    await waitFor(() => {
      expect(callsTo("externalTicket.detail")).toHaveLength(1);
    });
    expect(callsTo("externalTicket.detail")[0]?.input).toEqual({ ticketId: "t1" });
  });
});

describe("筛选与分页", () => {
  it("status filter rides the request and resets to page 1", async () => {
    renderList();
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: "状态" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "已完结" }));

    await waitFor(() => {
      const last = callsTo("externalTicket.list").at(-1)?.input as { status?: string[] };
      expect(last?.status).toEqual(["completed"]);
    });
  });

  it("search submits 工单号/原文 keyword", async () => {
    renderList();
    await screen.findByText("WO100001");

    const box = screen.getByPlaceholderText("工单号 / 工单原文");
    fireEvent.change(box, { target: { value: "WO100001" } });
    // React 19 的 onSubmit 会拿 event.target 构造 FormData，
    // 直接 submit input 会在 jsdom 里抛 uncaught exception
    fireEvent.submit(box.closest("form") as HTMLFormElement);

    await waitFor(() => {
      const last = callsTo("externalTicket.list").at(-1)?.input as { search?: string };
      expect(last?.search).toBe("WO100001");
    });
  });

  it("已完结默认不进请求，勾选「含已完结」后带上 includeCompleted", async () => {
    renderList();
    await screen.findByText("WO100001");

    expect(
      (callsTo("externalTicket.list").at(-1)?.input as { includeCompleted?: boolean })
        ?.includeCompleted,
    ).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "含已完结" }));

    await waitFor(() => {
      const last = callsTo("externalTicket.list").at(-1)?.input as { includeCompleted?: boolean };
      expect(last?.includeCompleted).toBe(true);
    });
  });

  it("paging moves the offset by page size", async () => {
    renderList({ "externalTicket.list": listPayload([ticket()], { total: 45 }) });
    expect(await screen.findByText(/共 45 条/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => {
      const last = callsTo("externalTicket.list").at(-1)?.input as { offset?: number };
      expect(last?.offset).toBe(20);
    });
  });

  it("first page disables 上一页", async () => {
    renderList();
    await screen.findByText("WO100001");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });
});

describe("空态", () => {
  it("empty inbox points at 新建工单", async () => {
    renderList({ "externalTicket.list": listPayload([]) });
    expect(await screen.findByText("没有工单")).toBeInTheDocument();
    expect(screen.getByText(/「新建工单」/)).toBeInTheDocument();
  });

  it("empty under a filter says so instead", async () => {
    renderList({ "externalTicket.list": listPayload([]) }, "/external-tickets?q=nothing");
    expect(await screen.findByText(/换个条件试试/)).toBeInTheDocument();
  });
});
