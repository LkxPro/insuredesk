import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { PRESET_ROLES, type Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 按排班自动分配 entry points (issue #31): the per-row 自动分配 action exists
 * only on 未分配 rows, the selection-bar button disables when the selection
 * contains assigned tickets, confirming fires ticket.autoAssign, and skipped
 * (no on-duty) tickets keep their selection for the manual fallback. Same
 * faked-fetch tRPC pipeline and useAuth-seam mock as TicketsPage.assign.test.
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

type ListItem = {
  id: string;
  workOrderNumber: string;
  createdAt: string;
  source: string;
  channel: string;
  category: string;
  complaintLevel: string;
  customerName: string;
  policyNumber: string;
  status: string;
  displayStatus: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
};

function listItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "投诉-保费收取问题",
    complaintLevel: "一般投诉",
    customerName: "王小明",
    policyNumber: "P2026070900123",
    status: "unassigned",
    displayStatus: "unassigned",
    assigneeId: null,
    assigneeName: null,
    dueAt: "2026-07-11T02:00:00.000Z",
    ...overrides,
  };
}

type AutoAssignResult = {
  assigned: { ticketId: string; workOrderNumber: string; assigneeName: string }[];
  skipped: { ticketId: string; workOrderNumber: string; channel: string }[];
};

// Canned per-procedure payloads + a log of every decoded call.
const canned = {
  items: [] as ListItem[],
  total: 0,
  autoAssign: null as AutoAssignResult | null,
};
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0 };
  }
  if (path === "ticket.list") {
    const page = ((input as Record<string, unknown> | undefined)?.page as number | undefined) ?? 1;
    return { items: canned.items, total: canned.total, page, pageSize: 20 };
  }
  if (path === "ticket.autoAssign") {
    if (canned.autoAssign) {
      return canned.autoAssign;
    }
    // Default: everything requested gets assigned to 张客服
    const { ticketIds } = input as { ticketIds: string[] };
    return {
      assigned: ticketIds.map((ticketId) => ({
        ticketId,
        workOrderNumber: `WO-${ticketId}`,
        assigneeName: "张客服",
      })),
      skipped: [],
    } satisfies AutoAssignResult;
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

function renderTickets() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/tickets"]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = userWith(PRESET_ROLES.CS_MANAGER);
  auth.isLoading = false;
  canned.items = [];
  canned.total = 0;
  canned.autoAssign = null;
  calls = [];
});

describe("per-row 自动分配", () => {
  it("exists on 未分配 rows only, and confirming fires ticket.autoAssign for that ticket", async () => {
    canned.items = [
      listItem(),
      listItem({
        id: "t2",
        workOrderNumber: "WO100002",
        status: "assigned",
        displayStatus: "assigned",
        assigneeId: "u-zhang",
        assigneeName: "张客服",
      }),
    ];
    canned.total = 2;
    renderTickets();
    await screen.findByText("WO100001");

    // one 自动分配 for the unassigned row; the assigned row offers 改派 only
    expect(screen.getAllByRole("button", { name: "自动分配" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "改派" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "自动分配" }));
    expect(await screen.findByRole("heading", { name: "按排班自动分配" })).toBeInTheDocument();
    expect(screen.getByText(/在手工单最少者（平手随机取一）/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.autoAssign")?.input).toEqual({
        ticketIds: ["t1"],
      }),
    );
  });
});

describe("selection-bar 按排班自动分配", () => {
  it("fires one autoAssign for the whole selection and clears the assigned ids", async () => {
    canned.items = [listItem(), listItem({ id: "t2", workOrderNumber: "WO100002" })];
    canned.total = 2;
    renderTickets();
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100002" }));
    fireEvent.click(screen.getByRole("button", { name: "按排班自动分配" }));

    expect(await screen.findByRole("heading", { name: "按排班自动分配" })).toBeInTheDocument();
    expect(screen.getByText("已选 2 个未分配工单。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticket.autoAssign")?.input).toEqual({
        ticketIds: ["t1", "t2"],
      }),
    );
    // Both were assigned → the selection is spent
    await waitFor(() => expect(screen.queryByText("已选 2 个工单")).not.toBeInTheDocument());
  });

  it("disables when the selection contains an already-assigned ticket", async () => {
    canned.items = [
      listItem(),
      listItem({
        id: "t2",
        workOrderNumber: "WO100002",
        status: "assigned",
        displayStatus: "assigned",
        assigneeId: "u-zhang",
        assigneeName: "张客服",
      }),
    ];
    canned.total = 2;
    renderTickets();
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100002" }));

    expect(screen.getByRole("button", { name: "按排班自动分配" })).toBeDisabled();
    expect(screen.getByText("自动分配仅适用于未分配工单")).toBeInTheDocument();
  });

  it("keeps skipped (no on-duty) tickets selected for the manual fallback", async () => {
    canned.items = [listItem()];
    canned.total = 1;
    canned.autoAssign = {
      assigned: [],
      skipped: [{ ticketId: "t1", workOrderNumber: "WO100001", channel: "保司" }],
    };
    renderTickets();
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 WO100001" }));
    fireEvent.click(screen.getByRole("button", { name: "按排班自动分配" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));

    await waitFor(() => expect(calls.some((call) => call.path === "ticket.autoAssign")).toBe(true));
    // Nothing was assigned — the ticket stays selected, ready for 批量分配
    expect(screen.getByText("已选 1 个工单")).toBeInTheDocument();
  });
});
