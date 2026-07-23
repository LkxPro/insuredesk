import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * In-place edit mode: 编辑 works in ANY status (已完结 included) and switches
 * the SAME dialog to edit mode in place — editable fields become controls at
 * their read-only positions, system/SLA sections stay read-only, changed
 * fields carry a 已修改 highlight, and 取消/保存 returns to read-only without
 * ever closing the dialog. 删除 fires nothing until the double-confirmation
 * dialog's destructive confirm, then leaves for the list. Same faked-fetch
 * tRPC pipeline and useAuth-seam mock as the follow-up/resolve tests.
 */

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: false,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    isLoading: auth.isLoading,
    hasPermission: (permission: Permission) => auth.user?.permissions.includes(permission) ?? false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Radix Select drives its dropdown with pointer-capture and scroll APIs that
// jsdom doesn't implement.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

function userWith(role: { name: string; permissions: readonly Permission[] }): AuthUser {
  return {
    id: "u1",
    username: "tester",
    name: "测试用户",
    email: null,
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
  };
}

/** serializeTicketDetail wire shape with in-flight defaults. */
function detailPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-09T02:00:00.000Z",
    updatedAt: "2026-07-09T03:00:00.000Z",
    feedbackTime: "2026-07-09T01:00:00.000Z",
    source: "manual",
    createdBy: "测试用户",
    channel: { id: "ch-baosi", name: "保司", active: true },
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    internalOrderNumber: null,
    policyNumbers: ["P2026070900123"],
    userComplaintChannel: "400热线",
    complaintReceiveChannel: "监管转办",
    customerName: "王小明",
    phone: "13800000001",
    contactPhone: null,
    customerRequest: "对理赔进度有异议",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    contactTime: null,
    contactId: null,
    category: { id: "cat-claims", name: "理赔投诉", active: true },
    complaintLevel: "一般投诉",
    priority: null,
    followUpFrequency: "24小时内累计跟进1次；48小时内累计跟进2次",
    firstResponseRequirement: "120分钟内完成首次响应",
    status: "processing",
    displayStatus: "processing",
    assigneeId: "u1",
    assigneeName: "测试用户",
    assignedAt: "2026-07-09T03:00:00.000Z",
    dueAt: "2026-07-11T02:00:00.000Z",
    nextContactTime: null,
    contactCount: 1,
    processingResult: "已电话联系客户",
    completionTime: null,
    completionStatus: null,
    processLogs: [
      {
        id: "log1",
        operatorId: "u1",
        operatorName: "测试用户",
        operatorAvatar: null,
        action: "create",
        from: null,
        to: null,
        remark: "创建工单",
        at: "2026-07-09T02:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

// Canned detail payload + a log of every decoded call.
let detail: Record<string, unknown>;
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  // The AppLayout bell polls notification.list in the same batch
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.detail") {
    return detail;
  }
  if (path === "ticket.edit") {
    const { ticketId, customerName } = input as { ticketId: string; customerName: string };
    // The server diffs submitted values against the stored row; tests only
    // ever change 客户姓名, so the canned diff keys off it
    return {
      id: ticketId,
      workOrderNumber: "WO100001",
      changedFields: customerName === detail.customerName ? [] : ["customerName"],
    };
  }
  if (path === "ticket.delete") {
    const { ticketId } = input as { ticketId: string };
    return { id: ticketId, workOrderNumber: "WO100001" };
  }
  // The list renders behind the route-driven detail dialog; the option feeds
  // serve both its filter toolbar and the edit dialog's pickers
  if (path === "ticket.list") {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  if (
    path === "ticket.assigneeOptions" ||
    path === "ticketCategory.options" ||
    path === "channel.options" ||
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "completionStatus.filterOptions"
  ) {
    return [];
  }
  throw new Error(`Unexpected tRPC path: ${path}`);
}

/** Decode batched tRPC calls: GET carries `input` in the URL, POST in the body. */
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const raw = init?.method === "POST" ? String(init.body) : url.searchParams.get("input");
  const batch = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

  const body = paths.map((path, index) => {
    const procedureInput = batch[String(index)];
    calls.push({ path, input: procedureInput });
    return { result: { data: respond(path, procedureInput) } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/tickets/t1"]}>
            <AppRoutes />
          </MemoryRouter>
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  auth.isLoading = false;
  detail = detailPayload();
  calls = [];
});

describe("in-place edit mode (原地切换)", () => {
  it("switches the same dialog: editable fields become inputs, system/SLA sections stay read-only text", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    // No second dialog ever opens
    await screen.findByLabelText("客户姓名");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const dialog = within(screen.getByRole("dialog"));

    // Editable field at its read-only position, prefilled
    expect(dialog.getByLabelText("客户姓名")).toHaveValue("王小明");
    expect(dialog.getByRole("combobox", { name: /客诉类别/ })).toHaveTextContent("理赔投诉");

    // System fields (工单号/创建时间/来源) and SLA fields keep rendering as text
    expect(dialog.getByText("工单号")).toBeInTheDocument();
    expect(dialog.getByText("处理时限")).toBeInTheDocument();
    expect(dialog.queryByLabelText("工单号")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("处理时限")).not.toBeInTheDocument();

    // Lifecycle actions stay out of the way while editing
    expect(dialog.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "完结工单" })).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
  });

  it("keeps 完结信息 read-only in place when editing a completed ticket", async () => {
    detail = detailPayload({
      status: "completed",
      displayStatus: "completed",
      completionTime: "2026-07-10T02:00:00.000Z",
      completionStatus: "已解决",
    });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    await screen.findByLabelText("客户姓名");
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("完结信息")).toBeInTheDocument();
    expect(dialog.getByText("已解决")).toBeInTheDocument();
    expect(dialog.queryByLabelText("完结状态")).not.toBeInTheDocument();
  });
});

describe("取消 and 改动高亮", () => {
  it("取消 with no changes returns straight to read-only — no 丢弃修改？, no mutation", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByLabelText("客户姓名");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    expect(calls.some((call) => call.path === "ticket.edit")).toBe(false);
    await waitFor(() => {
      expect(screen.queryByLabelText("客户姓名")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("取消 with changes asks 丢弃修改？ — confirming returns to read-only, dialog stays open", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    // Still in edit mode behind the confirmation — nothing discarded yet
    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王大明");

    fireEvent.click(screen.getByRole("button", { name: "丢弃修改" }));

    expect(calls.some((call) => call.path === "ticket.edit")).toBe(false);
    // Back to the read-only value inside the still-open dialog
    expect(await screen.findByText("王小明")).toBeInTheDocument();
    expect(screen.queryByLabelText("客户姓名")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("继续编辑 keeps the edit mode and the draft", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));

    await waitFor(() => {
      expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王大明");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
  });

  it("marks user-changed fields with a 已修改 highlight that clears on discarded 取消", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const nameInput = await screen.findByLabelText("客户姓名");
    expect(screen.queryByText("已修改")).not.toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: "王大明" } });
    expect(await screen.findByText("已修改")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "丢弃修改" }));
    await waitFor(() => {
      expect(screen.queryByText("已修改")).not.toBeInTheDocument();
    });
  });

  it("marks a field cleared back to empty as changed too", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByLabelText("客户姓名");
    fireEvent.click(screen.getByRole("button", { name: "清空时间" }));

    expect(await screen.findByText("已修改")).toBeInTheDocument();
  });
});

describe("saving in place", () => {
  it("toasts 未修改任何字段 and returns to read-only when nothing changed", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByLabelText("客户姓名");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("未修改任何字段")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText("客户姓名")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("prefills the current values, submits the full payload, toasts, then refetches the detail", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    // Prefilled from the detail — not a blank create form
    const nameInput = await screen.findByLabelText("客户姓名");
    expect(nameInput).toHaveValue("王小明");

    fireEvent.change(nameInput, { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.edit")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.edit");
    expect(mutation?.input).toMatchObject({
      ticketId: "t1",
      customerName: "王大明",
      // Untouched fields ride along unchanged — the server diffs them out
      channelId: "ch-baosi",
      complaintLevel: "一般投诉",
      policyNumbers: ["P2026070900123"],
      feedbackTime: "2026-07-09T01:00:00.000Z",
      complaintReceiveChannel: "监管转办",
      contactTime: null,
    });
    // status is not an editable field: never part of the payload
    expect(mutation?.input).not.toHaveProperty("status");

    // Success toast, back to read-only, dialog never closed
    expect(await screen.findByText("工单 WO100001 已更新")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText("客户姓名")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Fields, SLA derivations and the timeline all change server-side → refetch
    await waitFor(() => {
      expect(calls.filter((call) => call.path === "ticket.detail").length).toBeGreaterThan(1);
    });
  });

  it("keeps a since-停用 category selectable as the labelled current value (保持原值)", async () => {
    detail = detailPayload({ category: { id: "cat-claims", name: "理赔投诉", active: false } });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    // The options feed lists active categories only; the ticket's own disabled
    // value rides along labelled, so an unrelated edit keeps it untouched.
    const trigger = await screen.findByRole("combobox", { name: /客诉类别/ });
    expect(trigger).toHaveTextContent("理赔投诉（已停用）");

    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.edit")).toBe(true);
    });
    expect(calls.find((call) => call.path === "ticket.edit")?.input).toMatchObject({
      categoryId: "cat-claims",
      customerName: "王大明",
    });
  });

  it("keeps a since-停用 channel selectable as the labelled current value (保持原值)", async () => {
    detail = detailPayload({ channel: { id: "ch-baosi", name: "保司", active: false } });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const trigger = await screen.findByRole("combobox", { name: /反馈渠道/ });
    expect(trigger).toHaveTextContent("保司（已停用）");

    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.edit")).toBe(true);
    });
    expect(calls.find((call) => call.path === "ticket.edit")?.input).toMatchObject({
      channelId: "ch-baosi",
      customerName: "王大明",
    });
  });

  it("prefills 进线时间 and round-trips the same instant on submit", async () => {
    detail = detailPayload({ contactTime: "2026-07-08T13:15:00.000Z" });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.edit")).toBe(true);
    });
    expect(calls.find((call) => call.path === "ticket.edit")?.input).toMatchObject({
      contactTime: "2026-07-08T13:15:00.000Z",
    });
  });

  it("clears a filled 反馈时间 back to 未填写: submits feedbackTime as null (issue #62)", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    // Prefilled from the detail, so the clear affordance is present
    await screen.findByLabelText("客户姓名");
    fireEvent.click(screen.getByRole("button", { name: "清空时间" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.edit")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.edit");
    expect(mutation?.input).toMatchObject({
      ticketId: "t1",
      feedbackTime: null,
      // Other prefilled fields ride along unchanged
      customerName: "王小明",
      channelId: "ch-baosi",
    });
  });

  it("blocks an edit when only the feedback date remains", async () => {
    const user = userEvent.setup();
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await user.clear(await screen.findByLabelText("反馈时间的时分"));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("反馈时间需同时选择日期和时间")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "ticket.edit")).toBe(false);
  });
});

describe("弹窗关闭 across modes (issue #116)", () => {
  it("read-only: an outside click closes back to 工单管理", async () => {
    renderDetail();
    await screen.findByRole("button", { name: "编辑" });

    // Radix defers a left-button pointerdown outside until its click lands
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "工单管理" })).toBeInTheDocument();
  });

  it("edit mode with no changes: Esc closes the whole dialog without asking", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByLabelText("客户姓名");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
  });

  it("edit mode with changes: Esc asks 丢弃修改？, confirming closes onto the list", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "ticket.edit")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "丢弃修改" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "工单管理" })).toBeInTheDocument();
  });

  it("edit mode with changes: an outside click asks 丢弃修改？ instead of closing", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });

    // Radix defers a left-button pointerdown outside until its click lands
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王大明");
  });

  it("edit mode with changes: the X button asks too, 继续编辑 keeps everything", async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByLabelText("客户姓名"), { target: { value: "王大明" } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByText("丢弃修改？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));

    await waitFor(() => {
      expect(screen.queryByText("丢弃修改？")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("客户姓名")).toHaveValue("王大明");
  });
});

describe("删除 二次确认", () => {
  it("deletes only after the destructive confirm, then leaves for 工单管理", async () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));

    // The double confirmation: opening the dialog fires nothing yet
    await screen.findByText(/本期不提供恢复/);
    expect(calls.some((call) => call.path === "ticket.delete")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.delete")).toBe(true);
    });
    expect(calls.find((call) => call.path === "ticket.delete")?.input).toEqual({
      ticketId: "t1",
    });

    // The deleted ticket's dialog is gone for good — the success path closes it onto the list
    expect(await screen.findByRole("heading", { name: "工单管理" })).toBeInTheDocument();
  });

  it("取消 closes the dialog without firing the mutation", async () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByText(/本期不提供恢复/)).not.toBeInTheDocument();
    });
    expect(calls.some((call) => call.path === "ticket.delete")).toBe(false);
  });
});
