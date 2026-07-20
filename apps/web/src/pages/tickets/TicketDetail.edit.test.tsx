import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * Detail-page entry points: 编辑 exists for ticket.edit holders in
 * ANY status (已完结 included) and submits the full basic-info payload —
 * status not among the fields; 删除 exists only for ticket.delete holders,
 * fires nothing until the double-confirmation dialog's destructive confirm,
 * then leaves for the list. Same faked-fetch tRPC pipeline and useAuth-seam
 * mock as the follow-up/resolve tests.
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
    policyNumber: "P2026070900123",
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
    const { ticketId } = input as { ticketId: string };
    return { id: ticketId, workOrderNumber: "WO100001", changedFields: ["customerName"] };
  }
  if (path === "ticket.delete") {
    const { ticketId } = input as { ticketId: string };
    return { id: ticketId, workOrderNumber: "WO100001" };
  }
  // Post-delete navigation target (工单管理) and the picker its toolbar loads
  if (path === "ticket.list") {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  if (
    path === "ticket.assigneeOptions" ||
    path === "ticketCategory.options" ||
    path === "channel.options"
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

describe("编辑 entry-point gating", () => {
  it.each(["unassigned", "assigned", "processing", "completed"])(
    "shows the button to a ticket.edit holder on a %s ticket (任意状态含已完结)",
    async (status) => {
      detail = detailPayload({ status, displayStatus: status });
      renderDetail();

      expect(await screen.findByRole("button", { name: "编辑" })).toBeInTheDocument();
    },
  );

  it("hides the button without ticket.edit (一线客服)", async () => {
    auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
    renderDetail();

    await screen.findByText("处理记录");
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });
});

describe("editing from the dialog", () => {
  it("prefills the current values, submits the full payload, then refetches the detail", async () => {
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
      policyNumber: "P2026070900123",
      feedbackTime: "2026-07-09T01:00:00.000Z",
      complaintReceiveChannel: "监管转办",
      contactTime: null,
    });
    // status is not an editable field: never part of the payload
    expect(mutation?.input).not.toHaveProperty("status");

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
});

describe("删除 entry-point gating and 二次确认", () => {
  it("hides the button without ticket.delete (客服主管有编辑无删除)", async () => {
    renderDetail();

    await screen.findByRole("button", { name: "编辑" });
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

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

    // The detail page is gone for good — the success path lands on the list
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
