import type { Permission } from "@insuredesk/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { latestChangelogVersion, markChangelogSeen } from "@/lib/changelog";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "./AppRoutes";
import { ThemeProvider } from "./components/ThemeProvider";

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

vi.mock("@/components/NotificationBell", () => ({
  NotificationBell: () => null,
}));

vi.mock("@/components/TodoBell", () => ({
  TodoBell: () => null,
}));

vi.mock("@/pages/dashboard/DashboardPage", () => ({
  DashboardPage: () => <h1>数据看板</h1>,
}));

vi.mock("@/pages/shift-types/ShiftTypesPage", () => ({
  ShiftTypesPage: () => <h1>班次管理</h1>,
}));

vi.mock("@/pages/profile/ChangePasswordCard", () => ({
  ChangePasswordCard: () => null,
}));

vi.mock("@/pages/profile/ApiKeysCard", () => ({
  ApiKeysCard: () => null,
}));

vi.mock("@/pages/users/UsersPage", () => ({
  UsersPage: () => <h1>用户管理</h1>,
}));
vi.mock("@/pages/roles/RolesPage", () => ({
  RolesPage: () => <h1>角色权限</h1>,
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
  window.localStorage.clear();
});

describe("menu visibility per role persona", () => {
  it("管理员 sees all nine entries", () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual([
      "数据看板",
      "工单管理",
      "用户管理",
      "外部账号管理",
      "角色权限",
      "排班表",
      "班次管理",
      "SLA 策略",
      "字典管理",
    ]);
  });

  it("客服主管 sees dashboard, tickets, and schedule", () => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理", "排班表"]);
  });

  it("一线客服 sees dashboard and tickets", () => {
    auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理"]);
  });

  it("只读观察 sees dashboard and tickets", () => {
    auth.user = userWith(TEST_ROLES.READ_ONLY);
    renderAt("/dashboard");
    expect(menuLabels()).toEqual(["数据看板", "工单管理"]);
  });
});

describe("route guards", () => {
  it("redirects to /403 when visiting a page without its permission", () => {
    auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
    renderAt("/users");
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });

  it.each(["/users", "/roles"])("客服主管 lacks the page permission: %s → 403", (path) => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderAt(path);
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });

  it("客服主管 lacks schedule.manage_shifts, so /shift-types is forbidden", () => {
    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderAt("/shift-types");
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });

  it("管理员 can open shift management", async () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/shift-types");
    expect(await screen.findByRole("heading", { name: "班次管理" })).toBeInTheDocument();
  });

  it("renders the page when the permission is held", async () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/users");
    expect(await screen.findByRole("heading", { name: "用户管理" })).toBeInTheDocument();
  });

  it("redirects unauthenticated visitors to the login page", () => {
    renderAt("/dashboard");
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});

describe("index redirect", () => {
  it("lands on the first visible menu page", () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/");
    expect(screen.getByRole("heading", { name: "数据看板" })).toBeInTheDocument();
  });

  it("lands on /403 when the role has no page permissions", () => {
    auth.user = userWith({ name: "空角色", permissions: [] });
    renderAt("/");
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
  });
});

describe("个人资料", () => {
  it("侧边栏用户菜单入口 opens the profile page", async () => {
    auth.user = {
      ...userWith(TEST_ROLES.ADMIN),
      email: "admin@insuredesk.local",
      team: "平台组",
    };
    renderAt("/dashboard");

    const trigger = screen.getByRole("button", { name: /测试用户/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "个人资料" }));

    const heading = await screen.findByRole("heading", { name: "个人资料" });
    const page = within(heading.closest("div") as HTMLElement);
    expect(page.getByText("admin@insuredesk.local")).toBeInTheDocument();
    expect(page.getByText("平台组")).toBeInTheDocument();
  });

  it("shows username/name/role, and — for unset email/team", () => {
    auth.user = userWith(TEST_ROLES.READ_ONLY);
    renderAt("/profile");

    const heading = screen.getByRole("heading", { name: "个人资料" });
    const page = within(heading.closest("div") as HTMLElement);
    expect(page.getByText("tester")).toBeInTheDocument();
    expect(page.getByText("测试用户")).toBeInTheDocument();
    expect(page.getByText("只读观察")).toBeInTheDocument();
    expect(page.getAllByText("—")).toHaveLength(2);
  });

  it("is open to a role with no page permissions", () => {
    auth.user = userWith({ name: "空角色", permissions: [] });
    renderAt("/profile");
    expect(screen.getByRole("heading", { name: "个人资料" })).toBeInTheDocument();
  });
});

describe("更新日志", () => {
  it("/changelog is open to a role with no page permissions", async () => {
    auth.user = userWith({ name: "空角色", permissions: [] });
    renderAt("/changelog");
    expect(await screen.findByRole("heading", { name: "更新日志" })).toBeInTheDocument();
  });

  it("does not appear in the sidebar menu", () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(menuLabels()).not.toContain("更新日志");
  });

  it("sidebar footer version links to /changelog", () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(screen.getByRole("link", { name: /^版本 / })).toHaveAttribute("href", "/changelog");
  });

  it("shows no unread marker once the latest bundled version was seen", () => {
    if (latestChangelogVersion !== null) markChangelogSeen(latestChangelogVersion);
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(screen.queryByRole("link", { name: /有未读更新/ })).toBeNull();
  });

  it("marks the version link unread when a bundled version was never seen", () => {
    expect(latestChangelogVersion).not.toBeNull();
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(screen.getByRole("link", { name: /有未读更新/ })).toHaveAttribute("href", "/changelog");
  });
});

describe("shell chrome", () => {
  it("shows the current user's name and role", () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderAt("/dashboard");
    expect(screen.getByText("测试用户")).toBeInTheDocument();
    expect(screen.getByText(/管理员/)).toBeInTheDocument();
  });

  it("logs out via the sidebar user menu", async () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    auth.logout.mockImplementation(async () => {
      auth.user = null;
    });
    renderAt("/dashboard");
    const trigger = screen.getByRole("button", { name: /测试用户/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "退出登录" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument());
  });
});
