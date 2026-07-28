import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { calls, callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 我的工单 列表：列跟着机构可见字段白名单走（白名单随响应下发），筛选与分页
 * 状态住在 URL 里，提交对话框只收工单原文。数据范围与字段裁剪是服务端的事，
 * 这里验证渲染与请求参数。
 */

const ORG = "org-1";

/** 白名单顺序即列顺序；这里刻意不按 TICKET_FIELDS 顺序，验证列跟着配置走。 */
const VISIBLE_FIELDS = ["workOrderNumber", "status", "feedbackTime", "processingResult"];

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
    ...overrides,
  };
}

function listPayload(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { items, total: items.length, visibleFields: VISIBLE_FIELDS, ...overrides };
}

function renderList(overrides: Record<string, unknown> = {}) {
  return renderApp({
    path: "/external-tickets",
    role: TEST_ROLES.EXTERNAL,
    externalOrgId: ORG,
    trpc: {
      "externalTicket.list": listPayload([ticket()]),
      // 行点击用例会真的切到详情路由；给详情一个合法响应，免得它拿
      // 默认空壳渲染崩掉（unhandled error 会让整个 vitest 进程判败）
      "externalTicket.detail": {
        ticket: ticket(),
        visibleFields: VISIBLE_FIELDS,
        processLogs: [],
      },
      ...overrides,
    },
  });
}

describe("列渲染跟随机构白名单", () => {
  it("renders one column per visible field, in whitelist order", async () => {
    renderList();

    // 列头随响应到达才渲染（加载中只有骨架行），所以等 findAllBy。
    // 取词用 listLabel override（客户反馈时间 → 反馈时间），与 工单管理 一致
    const headers = (await screen.findAllByRole("columnheader")).map((cell) => cell.textContent);
    expect(headers).toEqual(["工单号", "状态", "反馈时间", "最新跟进"]);
  });

  it("a different whitelist yields different columns without code changes", async () => {
    renderList({
      "externalTicket.list": listPayload([ticket({ categoryName: "理赔纠纷" })], {
        visibleFields: ["workOrderNumber", "categoryId"],
      }),
    });

    const headers = (await screen.findAllByRole("columnheader")).map((cell) => cell.textContent);
    expect(headers).toEqual(["工单号", "类别"]);
    // 目录引用显示名字，不是 id
    expect(screen.getByText("理赔纠纷")).toBeInTheDocument();
  });

  it("shows — for a visible-but-empty field", async () => {
    renderList({
      "externalTicket.list": listPayload([ticket({ processingResult: "", feedbackTime: null })]),
    });

    await screen.findByText("WO100001");
    const row = screen.getByText("WO100001").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });
});

describe("筛选与分页", () => {
  it("status filter rides the request and resets to page 1", async () => {
    renderList();
    await screen.findAllByRole("columnheader");

    fireEvent.click(screen.getByRole("button", { name: "状态" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "已完结" }));

    await waitFor(() => {
      const last = callsTo("externalTicket.list").at(-1)?.input as { status?: string[] };
      expect(last?.status).toEqual(["completed"]);
    });
  });

  it("search submits 工单号/原文 keyword", async () => {
    renderList();
    await screen.findAllByRole("columnheader");

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

  it("paging moves the offset by page size", async () => {
    renderList({
      "externalTicket.list": listPayload([ticket()], { total: 45 }),
    });
    expect(await screen.findByText(/共 45 条/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => {
      const last = callsTo("externalTicket.list").at(-1)?.input as { offset?: number };
      expect(last?.offset).toBe(20);
    });
  });

  it("first page disables 上一页", async () => {
    renderList();
    await screen.findAllByRole("columnheader");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });
});

describe("进入详情", () => {
  it("工单号 is a link to the detail page (keyboard path)", async () => {
    renderList();
    await screen.findAllByRole("columnheader");

    const link = screen.getByRole("link", { name: "WO100001" });
    expect(link).toHaveAttribute("href", "/external-tickets/t1");
  });

  it("clicking anywhere on the row navigates too", async () => {
    renderList();
    await screen.findAllByRole("columnheader");

    fireEvent.click(screen.getByText("已联系客户"));

    // 详情页拉自己的 query，说明路由已经切过去
    await waitFor(() => {
      expect(callsTo("externalTicket.detail")).toHaveLength(1);
    });
    expect(callsTo("externalTicket.detail")[0]?.input).toEqual({ ticketId: "t1" });
  });
});

describe("空态与错误", () => {
  it("empty inbox invites a first submission", async () => {
    renderList({ "externalTicket.list": listPayload([]) });
    expect(await screen.findByText("没有工单")).toBeInTheDocument();
    expect(screen.getByText(/点击「提交工单」/)).toBeInTheDocument();
  });

  it("empty under a filter says so instead", async () => {
    renderApp({
      path: "/external-tickets?q=nothing",
      role: TEST_ROLES.EXTERNAL,
      externalOrgId: ORG,
      trpc: { "externalTicket.list": listPayload([]) },
    });
    expect(await screen.findByText(/换个条件试试/)).toBeInTheDocument();
  });
});

describe("提交工单", () => {
  it("submits the 原文 and refetches the list", async () => {
    renderList({
      "externalTicket.submit": { id: "t2", workOrderNumber: "WO100002" },
    });
    await screen.findAllByRole("columnheader");

    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    // 页面按钮与对话框提交按钮同名，作用域收到对话框里
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("工单原文"), {
      target: { value: "  客户要求退保  " },
    });
    fireEvent.click(dialog.getByRole("button", { name: "提交工单" }));

    await waitFor(() => {
      expect(callsTo("externalTicket.submit")).toHaveLength(1);
    });
    // 前后空白在提交前裁掉
    expect(callsTo("externalTicket.submit")[0]?.input).toEqual({
      submissionText: "客户要求退保",
    });
    expect(toastSpies.success).toHaveBeenCalledWith("工单 WO100002 已提交");
    await waitFor(() => {
      expect(callsTo("externalTicket.list").length).toBeGreaterThan(1);
    });
  });

  it("caps 原文 at 2000 chars and shows the counter", async () => {
    renderList();
    await screen.findAllByRole("columnheader");

    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    const dialog = within(await screen.findByRole("dialog"));
    const box = dialog.getByLabelText("工单原文");
    expect(box).toHaveAttribute("maxLength", "2000");

    fireEvent.change(box, { target: { value: "字".repeat(12) } });
    expect(dialog.getByText("12 / 2000 字，提交后不可修改。")).toBeInTheDocument();
  });

  it("blocks an empty 原文 client-side", async () => {
    renderList();
    await screen.findAllByRole("columnheader");

    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "提交工单" }));

    expect(await screen.findByText("请填写工单原文")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "externalTicket.submit")).toBe(false);
  });
});
