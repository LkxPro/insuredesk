import type { AuthUser } from "@/contexts/AuthContext";
import { PRESET_ROLES, type Permission } from "@insuredesk/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./AppRoutes";
import { ThemeProvider } from "./components/ThemeProvider";

/**
 * App shell behavior per issue #21: sidebar menu entries follow the current
 * user's page permissions, and direct URL access without the page permission
 * bounces to /403. Auth state is mocked at the useAuth seam — these tests
 * exercise routing and rendering, not the session plumbing.
 */

const auth = vi.hoisted(() => ({
  // AuthUser is type-only, so referencing it here survives vi.hoisted's
  // runtime hoisting above the imports.
  user: null as AuthUser | null,
  isLoading: false,
  logout: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    isLoading: auth.isLoading,
    hasPermission: (permission: Permission) => auth.user?.permissions.includes(permission) ?? false,
    login: vi.fn(),
    logout: auth.logout,
  }),
}));

// The header bell (issue #25) polls over tRPC, and these routing tests mount
// no tRPC provider — stub it at its seam, same spirit as the useAuth mock.
// Its real behavior is covered in NotificationBell.test.tsx.
vi.mock("@/components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// Same for the 我的待办 indicator (issue #30), which shares that poll.
// Its real behavior is covered in TodoBell.test.tsx.
vi.mock("@/components/TodoBell", () => ({
  TodoBell: () => null,
}));

// Same treatment for the real 数据看板 page (issue #29): it queries
// dashboard.stats on mount. Its real behavior is covered in
// DashboardPage.test.tsx; here only the route/menu wiring matters.
vi.mock("@/pages/dashboard/DashboardPage", () => ({
  DashboardPage: () => <h1>数据看板</h1>,
}));

/** Demo user holding a preset role, mirroring what `auth.me` returns. */
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

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function menuLabels(): string[] {
  const nav = screen.getByRole("navigation");
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

beforeEach(() => {
  auth.user = null;
  auth.isLoading = false;
  auth.logout.mockReset();
});

describe("menu visibility per preset role", () => {
  it("管理员 sees all five entries", () => {
    auth.user = userWith(PRESET_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理", "用户管理", "角色权限", "排班配置"]);
  });

  it("客服主管 sees dashboard, tickets, schedule", () => {
    auth.user = userWith(PRESET_ROLES.CS_MANAGER);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理", "排班配置"]);
  });

  it("一线客服 sees dashboard and tickets", () => {
    auth.user = userWith(PRESET_ROLES.FRONTLINE_CS);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理"]);
  });

  it("只读观察 sees dashboard and tickets", () => {
    auth.user = userWith(PRESET_ROLES.READ_ONLY);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理"]);
  });
});

describe("route guards", () => {
  it("redirects to /403 when visiting a page without its permission", () => {
    auth.user = userWith(PRESET_ROLES.FRONTLINE_CS);
    renderAt("/users");
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });

  it.each(["/users", "/roles"])("客服主管 lacks the page permission: %s → 403", (path) => {
    auth.user = userWith(PRESET_ROLES.CS_MANAGER);
    renderAt(path);
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });

  it("客服主管 holds schedule.view, so /schedule renders", () => {
    auth.user = userWith(PRESET_ROLES.CS_MANAGER);
    renderAt("/schedule");
    expect(screen.getByRole("heading", { name: "排班配置" })).toBeInTheDocument();
  });

  it("renders the page when the permission is held", () => {
    auth.user = userWith(PRESET_ROLES.ADMIN);
    renderAt("/users");
    expect(screen.getByRole("heading", { name: "用户管理" })).toBeInTheDocument();
  });

  it("redirects unauthenticated visitors to the login page", () => {
    renderAt("/dashboard");
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});

describe("index redirect", () => {
  it("lands on the first visible menu page", () => {
    auth.user = userWith(PRESET_ROLES.ADMIN);
    renderAt("/");
    expect(screen.getByRole("heading", { name: "数据看板" })).toBeInTheDocument();
  });

  it("lands on /403 when the role has no page permissions", () => {
    auth.user = userWith({ name: "空角色", permissions: [] });
    renderAt("/");
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });
});

describe("shell chrome", () => {
  it("shows the current user's name and role", () => {
    auth.user = userWith(PRESET_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(screen.getByText("测试用户")).toBeInTheDocument();
    expect(screen.getByText(/管理员/)).toBeInTheDocument();
  });

  it("logs out via the sidebar button", async () => {
    auth.user = userWith(PRESET_ROLES.ADMIN);
    auth.logout.mockImplementation(async () => {
      auth.user = null;
    });
    renderAt("/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    // After the session is gone we land back on the login form.
    await waitFor(() => expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument());
  });
});
