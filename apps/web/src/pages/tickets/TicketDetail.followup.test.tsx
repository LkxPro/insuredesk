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
 * 添加跟进 entry point on the detail page: the card exists only for
 * holders of ticket.process on an in-flight (assigned/processing) ticket —
 * mirroring the API guards — and submitting fires ticket.addComment with the
 * remark, omitting an unset 下次联系时间 as null. Same faked-fetch tRPC
 * pipeline and useAuth-seam mock as the TicketsPage tests.
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

// Radix Select (the picker's 时/分) drives its dropdown with pointer-capture
// and scroll APIs that jsdom doesn't implement.
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
    policyNumber: "P2026070900123",
    userComplaintChannel: "400热线",
    complaintReceiveChannel: null,
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
    followUpFrequency: "每天跟进",
    firstResponseRequirement: "24小时内",
    status: "assigned",
    displayStatus: "assigned",
    assigneeId: "u1",
    assigneeName: "测试用户",
    assignedAt: "2026-07-09T03:00:00.000Z",
    dueAt: "2026-07-11T02:00:00.000Z",
    nextContactTime: null,
    contactCount: 0,
    processingResult: "",
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
  if (path === "ticket.addComment") {
    const { ticketId } = input as { ticketId: string };
    return { id: ticketId, workOrderNumber: "WO100001", status: "processing", contactCount: 1 };
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
  auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
  auth.isLoading = false;
  detail = detailPayload();
  calls = [];
});

describe("添加跟进 entry-point gating", () => {
  it("shows the card to a ticket.process holder on an assigned ticket", async () => {
    renderDetail();

    expect(await screen.findByLabelText("跟进备注")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交跟进" })).toBeInTheDocument();
  });

  it("hides the card without ticket.process (只读观察)", async () => {
    auth.user = userWith(TEST_ROLES.READ_ONLY);
    renderDetail();

    await screen.findByText("处理记录");
    expect(screen.queryByLabelText("跟进备注")).not.toBeInTheDocument();
  });

  it.each(["unassigned", "completed"])("hides the card on a %s ticket", async (status) => {
    detail = detailPayload({ status, displayStatus: status, assigneeId: null });
    renderDetail();

    await screen.findByText("处理记录");
    expect(screen.queryByLabelText("跟进备注")).not.toBeInTheDocument();
  });
});

describe("submitting a follow-up", () => {
  it("fires ticket.addComment with the remark and a null 下次联系时间 when unset, then refetches the detail", async () => {
    renderDetail();

    const remark = await screen.findByLabelText("跟进备注");
    const submit = screen.getByRole("button", { name: "提交跟进" });
    expect(submit).toBeDisabled(); // no remark yet

    fireEvent.change(remark, { target: { value: "已电话联系客户" } });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.addComment")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.addComment");
    expect(mutation?.input).toEqual({
      ticketId: "t1",
      remark: "已电话联系客户",
      nextContactTime: null,
    });

    // The card stays for the next follow-up, with the draft cleared
    await waitFor(() => {
      expect(screen.getByLabelText("跟进备注")).toHaveValue("");
    });
    // Server-derived fields changed → the detail is refetched
    expect(calls.filter((call) => call.path === "ticket.detail").length).toBeGreaterThan(1);
  });

  it("clears a set 下次联系时间 back to unset: submits nextContactTime as null (issue #62)", async () => {
    renderDetail();

    const remark = await screen.findByLabelText("跟进备注");
    fireEvent.change(remark, { target: { value: "已电话联系客户" } });

    // No value yet → no clear affordance
    expect(screen.queryByRole("button", { name: "清空时间" })).not.toBeInTheDocument();

    // Pick a date to give the field a value, surfacing the clear button
    fireEvent.click(screen.getByLabelText("下次联系时间（可选）"));
    const day = await screen.findByRole("button", { name: /15/ });
    fireEvent.click(day);

    const clear = await screen.findByRole("button", { name: "清空时间" });
    fireEvent.click(clear);
    expect(screen.queryByRole("button", { name: "清空时间" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.addComment")).toBe(true);
    });
    expect(calls.find((call) => call.path === "ticket.addComment")?.input).toEqual({
      ticketId: "t1",
      remark: "已电话联系客户",
      nextContactTime: null,
    });
  });
});
