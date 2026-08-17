import { type Permission, TICKET_CREATE_FIELD_KEYS } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 空白提交回归: the 新建工单 form submits with
 * only feedbackTime prefilled (打开对话框的时刻) — no required-field validation
 * errors, every OTHER unfilled field reaching the wire as null — no label
 * carries 选填/非必填 wording, and the detail dialog renders a null-heavy ticket
 * with consistent 未知 placeholders. Clearing feedbackTime restores the null
 * (未填写) semantics. Same faked-fetch tRPC pipeline and
 * useAuth-seam mock as the sibling ticket tests.
 */

/** Frozen 此刻 so the prefilled feedbackTime is a known, minute-precise instant. */
const NOW = new Date("2026-07-15T09:30:00.000Z");

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
    isExternal: false,
  };
}

/** serializeTicketDetail wire shape for a fully blank ticket. */
function blankDetailPayload() {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-10T02:00:00.000Z",
    updatedAt: "2026-07-10T02:00:00.000Z",
    feedbackTime: null,
    source: "manual",
    createdBy: "测试用户",
    channel: null,
    project: null,
    brokerageEntity: null,
    paymentChannel: null,
    internalOrderNumber: null,
    policyNumbers: [],
    userComplaintChannel: null,
    complaintReceiveChannel: null,
    customerName: null,
    phone: null,
    contactPhone: null,
    customerRequest: null,
    nuclearBodyStatus: null,
    hasContacted: null,
    contactTime: null,
    contactId: null,
    category: null,
    complaintLevel: null,
    priority: null,
    followUpFrequency: null,
    firstResponseRequirement: null,
    status: "unassigned",
    displayStatus: "unassigned",
    assigneeId: null,
    assigneeName: null,
    assignedAt: null,
    dueAt: null,
    nextContactTime: null,
    contactCount: 0,
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
        at: "2026-07-10T02:00:00.000Z",
      },
    ],
  };
}

let calls: Array<{ path: string; input: unknown }>;

function respond(path: string): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.list") {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  if (path === "ticket.create") {
    return { id: "t1", workOrderNumber: "WO100001" };
  }
  if (path === "ticket.detail") {
    return blankDetailPayload();
  }
  if (
    path === "ticket.assigneeOptions" ||
    path === "ticketCategory.options" ||
    path === "channel.options" ||
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "sla.options" ||
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
    return { result: { data: respond(path) } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={[path]}>
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
  calls = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("空白提交 (issue #43 + #62 反馈时间默认此刻)", () => {
  it("submits an untouched form: only feedbackTime prefilled to 此刻, every other field null", async () => {
    renderAt("/tickets/new");
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.create")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.create");
    // feedbackTime defaults to the open instant, minute precision (秒归零)；
    // 多值保单号的「未填写」形态是空数组而非 null
    expect(mutation?.input).toEqual({
      ...Object.fromEntries(TICKET_CREATE_FIELD_KEYS.map((key) => [key, null])),
      feedbackTime: NOW.toISOString(),
      policyNumbers: [],
      noPolicyNumber: false,
    });

    // 建单后留列表: the dialog closes onto 工单管理, no detail opens
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "新建工单" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "工单管理" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "WO100001" })).not.toBeInTheDocument();
  });

  it("clearing the prefilled feedbackTime submits it as null (未填写), others still null", async () => {
    renderAt("/tickets/new");
    await screen.findByRole("heading", { name: "新建工单" });

    // The prefilled default shows the clear affordance; clearing returns to 未填写
    fireEvent.click(screen.getByRole("button", { name: "清空时间" }));
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.create")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.create");
    expect(mutation?.input).toMatchObject({
      feedbackTime: null,
      channelId: null,
      customerName: null,
      hasContacted: null,
      complaintLevel: null,
    });
  });

  it("blocks creation when only the default feedback date remains", async () => {
    renderAt("/tickets/new");
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.input(screen.getByLabelText("反馈时间的时分"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    expect(await screen.findByText("反馈时间需同时选择日期和时间")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "ticket.create")).toBe(false);
  });

  it("labels carry no 选填/非必填 wording", async () => {
    renderAt("/tickets/new");
    await screen.findByRole("heading", { name: "新建工单" });

    expect(screen.queryByText(/选填/)).not.toBeInTheDocument();
    expect(screen.queryByText(/非必填/)).not.toBeInTheDocument();
  });
});

describe("空值展示 (issue #43)", () => {
  it("detail renders a fully blank ticket with 未知 placeholders, no crash", async () => {
    renderAt("/tickets/t1");

    expect(await screen.findByRole("heading", { name: "WO100001" })).toBeInTheDocument();
    // Unfilled fields all show the same placeholder
    expect(screen.getAllByText("—").length).toBeGreaterThan(5);
    expect(screen.queryByText("不设时限")).not.toBeInTheDocument();
  });
});
