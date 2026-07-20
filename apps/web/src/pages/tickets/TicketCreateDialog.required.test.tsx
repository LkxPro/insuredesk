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
 * Issue #99: 漏填必填项时，红字里的字段名与该输入框可见 label 逐字一致。
 * 覆盖三种控件形态：文本输入（客户电话（投保人））、目录下拉（反馈渠道）、
 * 三态下拉（客户曾进线）——含改名残留曾错位的「手机号/业务渠道/是否已联系」。
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

let calls: Array<{ path: string; input: unknown }>;

function respond(path: string): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticket.list") {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  if (
    path === "ticket.assigneeOptions" ||
    path === "ticketCategory.options" ||
    path === "channel.options" ||
    path === "channel.filterOptions" ||
    path === "ticketCategory.filterOptions" ||
    path === "completionStatus.filterOptions"
  ) {
    return [];
  }
  throw new Error(`Unexpected tRPC path: ${path}`);
}

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

function renderCreateDialog() {
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
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = {
    id: "u1",
    username: "tester",
    name: "测试用户",
    email: null,
    roleId: "r1",
    roleName: TEST_ROLES.CS_MANAGER.name,
    permissions: [...TEST_ROLES.CS_MANAGER.permissions],
    requiredTicketFields: ["phone", "channelId", "hasContacted"],
  };
  auth.isLoading = false;
  calls = [];
});

describe("必填红字与输入框 label 逐字一致 (issue #99)", () => {
  it("blank submit shows 标准名 red text for each missing required field, no mutation fired", async () => {
    renderCreateDialog();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    expect(await screen.findByText("客户电话（投保人）为必填项")).toBeInTheDocument();
    expect(screen.getByText("反馈渠道为必填项")).toBeInTheDocument();
    expect(screen.getByText("客户曾进线为必填项")).toBeInTheDocument();

    // 改名残留不再出现
    for (const stale of ["手机号为必填项", "业务渠道为必填项", "是否已联系为必填项"]) {
      expect(screen.queryByText(stale)).not.toBeInTheDocument();
    }

    // 红字里的字段名正是该输入框的可见 label
    expect(screen.getByLabelText(/^客户电话（投保人）/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^反馈渠道/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^客户曾进线/ })).toBeInTheDocument();

    await waitFor(() => {
      expect(calls.some((call) => call.path === "ticket.create")).toBe(false);
    });
  });
});
