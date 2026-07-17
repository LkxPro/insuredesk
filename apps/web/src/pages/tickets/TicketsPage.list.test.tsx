import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * List page: rows render from ticket.list with the computed display status,
 * URL filters reach the query input (deep-linkable like /tickets/new), and
 * search / sort / pagination re-query with the right input. The tRPC link
 * gets a faked `fetch`, so the real procedure pipeline shape is exercised
 * without a server. Same useAuth-seam mock as TicketsPage.test.tsx.
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
    requiredTicketFields: [],
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
    status: "processing",
    displayStatus: "processing",
    assigneeName: "李客服",
    dueAt: "2026-07-11T02:00:00.000Z",
    ...overrides,
  };
}

// Per-test canned list payload + a log of every decoded ticket.list input.
const canned = { items: [] as ListItem[], total: 0 };
let listInputs: Array<Record<string, unknown>>;

/** tRPC batched queries arrive as GET with `input={"0":…}` in the URL. */
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const raw = url.searchParams.get("input");
  const batch = raw ? (JSON.parse(raw) as Record<string, Record<string, unknown>>) : {};
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const body = paths.map((path, index) => {
    // The AppLayout bell polls notification.list in the same batch;
    // an empty inbox keeps these tests focused on ticket.list.
    if (path === "notification.list") {
      return { result: { data: { items: [], unreadCount: 0, todo: { items: [], count: 0 } } } };
    }
    if (path === "channel.filterOptions") {
      return {
        result: {
          data: [
            { id: "ch-baosi", name: "保司", active: true },
            { id: "ch-pay", name: "支付", active: true },
            { id: "ch-legacy", name: "旧渠道", active: false },
          ],
        },
      };
    }
    if (path === "completionStatus.filterOptions") {
      return {
        result: {
          data: [
            { id: "cs-normal", name: "正常完结", active: true },
            { id: "cs-legacy", name: "旧完结状态", active: false },
          ],
        },
      };
    }
    const procedureInput = batch[String(index)] ?? {};
    listInputs.push(procedureInput);
    const page = (procedureInput.page as number | undefined) ?? 1;
    return {
      result: {
        data: { items: canned.items, total: canned.total, page, pageSize: 20 },
      },
    };
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
  canned.items = [];
  canned.total = 0;
  listInputs = [];
});

describe("list rendering", () => {
  it("renders one row per ticket with the computed display status", async () => {
    canned.items = [
      listItem(),
      listItem({
        id: "t2",
        workOrderNumber: "WO100002",
        customerName: "赵一超",
        status: "assigned",
        displayStatus: "overdue",
        assigneeName: null,
      }),
    ];
    canned.total = 2;

    renderAt("/tickets");

    expect(await screen.findByText("WO100001")).toBeInTheDocument();
    expect(screen.getByText("WO100002")).toBeInTheDocument();
    expect(screen.getByText("王小明")).toBeInTheDocument();
    // The overdue row shows the computed status, not the stored one
    expect(screen.getByText("已超时")).toBeInTheDocument();
    expect(screen.queryByText("已分配")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    renderAt("/tickets");
    expect(await screen.findByText("暂无匹配的工单")).toBeInTheDocument();
  });
});

describe("URL-driven filters (deep-linkable)", () => {
  it("passes status/channel from the query string into ticket.list", async () => {
    renderAt("/tickets?status=overdue&channel=ch-pay");

    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ status: "overdue", channelId: "ch-pay" });
  });

  it("按停用渠道筛选：查询带其 id，触发器显示（已停用）标注", async () => {
    renderAt("/tickets?channel=ch-legacy");

    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ channelId: "ch-legacy" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "渠道" })).toHaveTextContent("旧渠道（已停用）"),
    );
  });

  it("按停用完结状态筛选：查询带其 id，触发器显示（已停用）标注", async () => {
    renderAt("/tickets?completionStatus=cs-legacy");

    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ completionStatusId: "cs-legacy" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "完结状态" })).toHaveTextContent(
        "旧完结状态（已停用）",
      ),
    );
  });

  it("ignores an invalid query string and lists with defaults", async () => {
    renderAt("/tickets?status=nonsense&page=x");

    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]?.status).toBeUndefined();
    expect(listInputs[0]).toMatchObject({ page: 1 });
  });

  it("keeps valid filters when a neighbouring param is malformed", async () => {
    renderAt("/tickets?status=overdue&page=x");

    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));
    expect(listInputs[0]).toMatchObject({ status: "overdue", page: 1 });
  });
});

describe("search / sort / pagination re-query", () => {
  it("submitting the search box queries with the entered text", async () => {
    renderAt("/tickets");
    await waitFor(() => expect(listInputs.length).toBeGreaterThan(0));

    const searchBox = screen.getByRole("searchbox");
    fireEvent.change(searchBox, { target: { value: "三丰" } });
    fireEvent.submit(searchBox.closest("form") as HTMLFormElement);

    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ search: "三丰" }));
  });

  it("clicking 创建时间 flips to ascending; clicking 处理时限 sorts by dueAt soonest-first", async () => {
    canned.items = [listItem()];
    canned.total = 1;
    renderAt("/tickets");
    await screen.findByText("WO100001");

    fireEvent.click(screen.getByRole("button", { name: /创建时间/ }));
    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ sortBy: "createdAt", sortOrder: "asc" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /处理时限/ }));
    await waitFor(() =>
      expect(listInputs.at(-1)).toMatchObject({ sortBy: "dueAt", sortOrder: "asc" }),
    );
  });

  it("下一页 advances the page against the filtered total", async () => {
    canned.items = [listItem()];
    canned.total = 45;
    renderAt("/tickets");
    await screen.findByText("WO100001");
    expect(screen.getByText(/共 45 条/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(listInputs.at(-1)).toMatchObject({ page: 2 }));
  });
});
