import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 数据看板 page: the 8 metric cards, the channel table, the Top-10 考核表,
 * and the own-scope hint all render from dashboard.stats. The tRPC link gets
 * a faked `fetch` (same seam as TicketsPage.list.test.tsx), so the page runs
 * against the real procedure pipeline shape without a server. All 口径 are
 * server-side and covered by the API integration tests; here the payload is
 * canned and only the rendering is under test.
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
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
    externalOrgId: null,
  };
}

type StatsPayload = {
  scope: "all" | "own";
  metrics: Record<string, number>;
  channels: Array<{ channelId: string; name: string; count: number }>;
  assignees: Array<{
    assigneeId: string;
    assigneeName: string;
    totalCount: number;
    completedCount: number;
    avgCompletionMs: number | null;
    overdueCount: number;
    overdueRate: number;
  }>;
};

function statsPayload(overrides: Partial<StatsPayload> = {}): StatsPayload {
  return {
    scope: "all",
    metrics: {
      total: 42,
      unassigned: 5,
      assigned: 7,
      processing: 11,
      completed: 19,
      pendingTimeout: 3,
      overdue: 2,
      urgent: 1,
    },
    channels: [
      { channelId: "ch-1", name: "保司", count: 20 },
      { channelId: "ch-2", name: "经纪", count: 10 },
      { channelId: "ch-3", name: "支付", count: 6 },
      { channelId: "ch-4", name: "监管", count: 6 },
    ],
    assignees: [
      {
        assigneeId: "cs-1",
        assigneeName: "张客服",
        totalCount: 20,
        completedCount: 15,
        avgCompletionMs: 30.5 * 60 * 60 * 1000, // 1天6.5小时
        overdueCount: 5,
        overdueRate: 0.25,
      },
      {
        assigneeId: "cs-2",
        assigneeName: "李客服",
        totalCount: 8,
        completedCount: 0,
        avgCompletionMs: null,
        overdueCount: 0,
        overdueRate: 0,
      },
    ],
    ...overrides,
  };
}

// Per-test canned payload; a null response makes the procedure error instead.
const canned = { stats: statsPayload() as StatsPayload | null };

/** tRPC batched queries arrive as GET; answer each path in the batch. */
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const body = paths.map((path) => {
    // The AppLayout bell polls notification.list in the same batch.
    if (path === "notification.list") {
      return { result: { data: { items: [], unreadCount: 0, todo: { items: [], count: 0 } } } };
    }
    if (canned.stats === null) {
      return { error: { message: "boom", code: -32603, data: { httpStatus: 500 } } };
    }
    return { result: { data: canned.stats } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/dashboard"]}>
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
  canned.stats = statsPayload();
});

describe("指标卡", () => {
  it("renders all 8 cards with their labels and values", async () => {
    renderDashboard();

    expect(await screen.findByText("工单总数")).toBeInTheDocument();
    for (const label of [
      "未分配",
      "待处理",
      "处理中",
      "已完结",
      "2小时超时预警",
      "已超时",
      "特急工单",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("42")).toBeInTheDocument(); // total
    expect(screen.getByText("19")).toBeInTheDocument(); // completed
    expect(screen.getByText("2")).toBeInTheDocument(); // overdue
  });
});

describe("渠道统计表", () => {
  it("renders the channel distribution with catalog names and counts", async () => {
    renderDashboard();

    // Await a data row, not the card title — the title renders while loading.
    expect(await screen.findByText("保司")).toBeInTheDocument();
    for (const channel of ["经纪", "支付", "监管"]) {
      expect(screen.getByText(channel)).toBeInTheDocument();
    }
    expect(screen.getByText("20")).toBeInTheDocument();
  });
});

describe("跟进人考核表", () => {
  it("renders one row per assignee with duration and rate formatting", async () => {
    renderDashboard();

    expect(await screen.findByText("张客服")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument(); // 完单数
    expect(screen.getByText("1天6.5小时")).toBeInTheDocument(); // avgCompletionMs formatted
    expect(screen.getByText("25%")).toBeInTheDocument(); // overdueRate formatted
    // No completions yet → duration placeholder, zero rate
    expect(screen.getByText("李客服")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows an empty state when nobody holds a ticket yet", async () => {
    canned.stats = statsPayload({ assignees: [] });
    renderDashboard();
    expect(await screen.findByText("暂无考核数据")).toBeInTheDocument();
  });
});

describe("数据范围提示", () => {
  it("shows the own-scope badge only when the server scoped the numbers", async () => {
    canned.stats = statsPayload({ scope: "own" });
    renderDashboard();
    expect(await screen.findByText("仅统计我名下的工单")).toBeInTheDocument();
  });

  it("hides the badge for view_all scopes", async () => {
    renderDashboard();
    expect(await screen.findByText("工单总数")).toBeInTheDocument();
    expect(screen.queryByText("仅统计我名下的工单")).not.toBeInTheDocument();
  });
});

describe("加载失败", () => {
  it("surfaces the query error", async () => {
    canned.stats = null;
    renderDashboard();
    expect(await screen.findByText("看板数据加载失败")).toBeInTheDocument();
  });
});
