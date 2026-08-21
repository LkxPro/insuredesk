import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/components/ToastHost";
import type { AuthUser } from "@/contexts/AuthContext";
import { toastStore } from "@/lib/toast-store";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

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

const EXISTING_ROW = {
  id: "t-old",
  workOrderNumber: "WO100001",
  createdAt: "2026-07-09T02:00:00.000Z",
  source: "manual",
  channel: "保司",
  category: "理赔投诉",
  complaintLevel: "一般投诉",
  customerName: "王小明",
  policyNumbers: ["P2026070900123"],
  status: "processing",
  displayStatus: "processing",
  assigneeId: "u2",
  assigneeName: "李客服",
  dueAt: "2026-07-11T02:00:00.000Z",
};

const CREATED_ROW = {
  id: "t-new",
  workOrderNumber: "WO100099",
  createdAt: "2026-07-15T09:30:00.000Z",
  source: "manual",
  channel: null,
  category: null,
  complaintLevel: null,
  customerName: null,
  policyNumbers: [],
  status: "unassigned",
  displayStatus: "unassigned",
  assigneeId: null,
  assigneeName: null,
  dueAt: null,
};

let created: boolean;
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.list") {
    const items = created ? [CREATED_ROW, EXISTING_ROW] : [EXISTING_ROW];
    return { items, total: items.length, page: 1, pageSize: 20 };
  }
  if (path === "ticket.create") {
    created = true;
    return { id: CREATED_ROW.id, workOrderNumber: CREATED_ROW.workOrderNumber };
  }
  if (
    path === "channel.options" ||
    path === "ticketCategory.options" ||
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
    calls.push({ path, input: batch[String(index)] });
    return { result: { data: respond(path) } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderCreate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/tickets/new"]}>
            <AppRoutes />
          </MemoryRouter>
          <ToastHost />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  auth.isLoading = false;
  created = false;
  calls = [];
  toastStore.clear();
});

describe("建单后留列表 (issue #116)", () => {
  it("closes onto 工单管理 with a 工单号 toast and the new row highlighted", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "新建工单" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "工单管理" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(await screen.findByText("工单 WO100099 已创建")).toBeInTheDocument();

    const newCell = await screen.findByText("WO100099");
    expect(newCell.closest("tr")).toHaveAttribute("data-highlighted");
    expect(screen.getByText("WO100001").closest("tr")).not.toHaveAttribute("data-highlighted");
  });
});
