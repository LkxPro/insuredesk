import type { Permission } from "@insuredesk/shared";
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
import { buildTicketExportUrl } from "./ticket-export";

/**
 * Issue #34 export entry point: the 导出 dropdown is gated on ticket.export
 * (无权限 UI 无入口), a format pick downloads via GET /api/tickets/export with
 * the URL carrying the list's *current* filters, and a server rejection
 * surfaces as a toast instead of a dead click. Same useAuth-seam mock and
 * faked tRPC fetch as TicketsPage.list.test.tsx; the export's own fetch is a
 * separate global stub, so the two transports never cross.
 */

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: false,
}));

// The Toaster outlet lives in main.tsx, outside this render tree — spy on the
// imperative API instead of hunting for rendered toast text.
const toastSpies = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastSpies }));

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

/** tRPC batched queries arrive as GET with `input={"0":…}` in the URL. */
function fakeTrpcFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  const paths = (url.pathname.split("/api/trpc/")[1] ?? "").split(",");
  const body = paths.map((path) => {
    if (path === "notification.list") {
      return { result: { data: { items: [], unreadCount: 0, todo: { items: [], count: 0 } } } };
    }
    if (path === "channel.filterOptions") {
      return { result: { data: [{ id: "ch-pay", name: "支付", active: true }] } };
    }
    return { result: { data: { items: [], total: 0, page: 1, pageSize: 20 } } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

// The export download's own fetch — global, unlike the tRPC link's injected one.
const exportFetch = vi.fn();

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeTrpcFetch })],
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
  exportFetch.mockReset();
  toastSpies.error.mockReset();
  vi.stubGlobal("fetch", exportFetch);
  // jsdom has no object-URL implementation; the download path needs both ends
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Open the Radix dropdown (pointerDown, jsdom-style) and pick a format. */
async function pickExport(itemName: RegExp) {
  const trigger = await screen.findByRole("button", { name: /导出/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: itemName }));
}

describe("permission gating (无权限 UI 无入口)", () => {
  it("hides the 导出 button without ticket.export", async () => {
    auth.user = userWith(TEST_ROLES.READ_ONLY); // ticket.view_all but no export
    renderAt("/tickets");

    expect(await screen.findByText("暂无匹配的工单")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
  });

  it("shows the 导出 button for holders of ticket.export", async () => {
    renderAt("/tickets");
    expect(await screen.findByRole("button", { name: /导出/ })).toBeInTheDocument();
  });
});

describe("按列表当前筛选条件导出", () => {
  it("downloads via /api/tickets/export with the current filters and picked format", async () => {
    exportFetch.mockResolvedValue(
      new Response("csv", { status: 200, headers: { "content-type": "text/csv" } }),
    );
    renderAt("/tickets?status=overdue&channel=ch-pay&q=三丰&sortBy=dueAt&sortOrder=asc&page=3");

    await pickExport(/CSV/);

    await waitFor(() => expect(exportFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(exportFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/tickets/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("status")).toBe("overdue");
    expect(url.searchParams.get("channelId")).toBe("ch-pay");
    expect(url.searchParams.get("search")).toBe("三丰");
    expect(url.searchParams.get("sortBy")).toBe("dueAt");
    expect(url.searchParams.get("sortOrder")).toBe("asc");
    expect(url.searchParams.get("timeZone")).toBeTruthy();
    // an export always covers every matching row — pagination never rides along
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("requests xlsx when Excel is picked", async () => {
    exportFetch.mockResolvedValue(new Response("x", { status: 200 }));
    renderAt("/tickets");

    await pickExport(/Excel/);

    await waitFor(() => expect(exportFetch).toHaveBeenCalledTimes(1));
    const url = new URL(String(exportFetch.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("format")).toBe("xlsx");
  });

  it("surfaces a server rejection as a toast", async () => {
    exportFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing required permission: ticket.export" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    renderAt("/tickets");

    await pickExport(/CSV/);

    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("Missing required permission: ticket.export"),
    );
  });
});

describe("buildTicketExportUrl", () => {
  it("omits unset filters and keeps set ones, with an explicit zone", () => {
    const url = buildTicketExportUrl(
      {
        status: "processing",
        channelId: undefined,
        complaintLevel: "特急投诉",
        source: undefined,
        search: undefined,
        sortBy: "createdAt",
        sortOrder: "desc",
        page: 5,
        pageSize: 20,
      },
      "xlsx",
      "Asia/Shanghai",
    );
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("status")).toBe("processing");
    expect(params.get("complaintLevel")).toBe("特急投诉");
    expect(params.get("channelId")).toBeNull();
    expect(params.get("source")).toBeNull();
    expect(params.get("search")).toBeNull();
    expect(params.get("timeZone")).toBe("Asia/Shanghai");
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });
});
