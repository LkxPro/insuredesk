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

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc" })],
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
  auth.user = null;
  auth.isLoading = false;
});

describe("新建工单 entry on /tickets", () => {
  it("客服主管 (holds ticket.create) sees the button, linked to /tickets/new", async () => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderAt("/tickets");
    const link = await screen.findByRole("link", { name: /新建工单/ });
    expect(link).toHaveAttribute("href", "/tickets/new");
  });

  it.each([
    ["一线客服", TEST_ROLES.FRONTLINE_CS],
    ["只读观察", TEST_ROLES.READ_ONLY],
  ])("%s (no ticket.create) has no entry at all", async (_name, role) => {
    auth.user = userWith(role);
    renderAt("/tickets");
    expect(await screen.findByRole("heading", { name: "工单管理" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /新建工单/ })).not.toBeInTheDocument();
  });
});

describe("/tickets/new route guard", () => {
  it("renders the creation form for 客服主管", async () => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderAt("/tickets/new");
    expect(await screen.findByRole("heading", { name: "新建工单" })).toBeInTheDocument();
  });

  it("bounces 一线客服 to /403", () => {
    auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
    renderAt("/tickets/new");
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });
});
