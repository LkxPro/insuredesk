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

type StatsPayload = {
  scope: "all" | "own";
  metrics: Record<string, number>;
  urgentPolicy: { id: string; name: string } | null;
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
    urgentPolicy: { id: "pol-top", name: "特急投诉" },
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
        avgCompletionMs: 30.5 * 60 * 60 * 1000,
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
    for (const label of ["未分配", "已分配", "处理中", "已完结", "待超时", "已超时"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("特急投诉")).toBeInTheDocument();
    expect(screen.getByText("最高档时效策略")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("无 active 策略时特急卡降级：固定文案，不随策略名", async () => {
    canned.stats = statsPayload({
      urgentPolicy: null,
      metrics: { ...statsPayload().metrics, urgent: 0 },
    });
    renderDashboard();

    expect(await screen.findByText("特急工单")).toBeInTheDocument();
    expect(screen.getByText("无启用的时效策略")).toBeInTheDocument();
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
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("1天6.5小时")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("李客服")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows an empty state when nobody holds a ticket yet", async () => {
    canned.stats = statsPayload({ assignees: [] });
    renderDashboard();
    expect(await screen.findByText("暂无考核数据")).toBeInTheDocument();
  });

  it("shows footnote explaining the two overdue 口径 and the partition", async () => {
    renderDashboard();
    expect(
      await screen.findByText(/超时单数为历史追责口径.*六张状态卡互斥，合计 = 工单总数/),
    ).toBeInTheDocument();
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

describe("卡片跳转工单管理", () => {
  it("total card links to tickets with no status filter", async () => {
    renderDashboard();

    const totalCard = (await screen.findByText("工单总数")).closest("a");
    expect(totalCard).toHaveAttribute("href", "/tickets");
  });

  it("unassigned card links to tickets with status=unassigned", async () => {
    renderDashboard();

    const unassignedCard = (await screen.findByText("未分配")).closest("a");
    expect(unassignedCard).toHaveAttribute("href", "/tickets?status=unassigned");
  });

  it("overdue card links to tickets with status=overdue", async () => {
    renderDashboard();

    const overdueCard = (await screen.findByText("已超时")).closest("a");
    expect(overdueCard).toHaveAttribute("href", "/tickets?status=overdue");
  });

  it("urgent card links to tickets with policyId of the bound policy", async () => {
    renderDashboard();

    const urgentCard = (await screen.findByText("特急投诉")).closest("a");
    expect(urgentCard).toHaveAttribute("href", "/tickets?policyId=pol-top");
  });

  it("cards include createdFrom/createdTo when dashboard has a time range", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const trpcClient = trpc.createClient({
      links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
    });

    render(
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <MemoryRouter
              initialEntries={["/dashboard?createdFrom=2026-07-01&createdTo=2026-07-31"]}
            >
              <AppRoutes />
            </MemoryRouter>
          </ThemeProvider>
        </QueryClientProvider>
      </trpc.Provider>,
    );

    const totalCard = (await screen.findByText("工单总数")).closest("a");
    expect(totalCard).toHaveAttribute(
      "href",
      "/tickets?createdFrom=2026-07-01&createdTo=2026-07-31",
    );

    const overdueCard = screen.getByText("已超时").closest("a");
    expect(overdueCard).toHaveAttribute(
      "href",
      "/tickets?status=overdue&createdFrom=2026-07-01&createdTo=2026-07-31",
    );
  });
});

describe("渠道行跳转工单管理", () => {
  it("channel rows are clickable", async () => {
    renderDashboard();

    const channelRow = (await screen.findByText("保司")).closest("tr");
    expect(channelRow).toHaveClass("cursor-pointer");
  });
});
