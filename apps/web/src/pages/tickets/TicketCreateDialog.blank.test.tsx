import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * Issue #43 UI regression: the 新建工单 form submits fully blank — no
 * required-field validation errors, every unfilled field reaching the wire as
 * null — no label carries 选填/非必填 wording, and the detail page renders a
 * null-heavy ticket with consistent 未知 placeholders. Same faked-fetch tRPC
 * pipeline and useAuth-seam mock as the sibling ticket tests.
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

function userWith(role: { name: string; permissions: readonly Permission[] }): AuthUser {
  return {
    id: "u1",
    username: "tester",
    name: "测试用户",
    email: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
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
    policyNumber: null,
    userComplaintChannel: null,
    customerName: null,
    phone: null,
    contactPhone: null,
    customerRequest: null,
    nuclearBodyStatus: null,
    hasContacted: null,
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
  if (path === "ticket.assigneeOptions") {
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
});

describe("完全空白提交 (issue #43)", () => {
  it("submits an untouched form: no validation errors, all fields null on the wire", async () => {
    renderAt("/tickets/new");
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.create")).toBe(true);
    });
    const mutation = calls.find((call) => call.path === "ticket.create");
    expect(mutation?.input).toMatchObject({
      feedbackTime: null,
      channel: null,
      project: null,
      customerName: null,
      phone: null,
      customerRequest: null,
      nuclearBodyStatus: null,
      hasContacted: null,
      category: null,
      complaintLevel: null,
      priority: null,
    });

    // Success path is unchanged: straight to the new ticket's detail
    expect(await screen.findByRole("heading", { name: "WO100001" })).toBeInTheDocument();
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
    // hasContacted unknown: neither 是 nor 否 is asserted
    expect(screen.queryByText("不设时限（特急）")).not.toBeInTheDocument();
  });
});
