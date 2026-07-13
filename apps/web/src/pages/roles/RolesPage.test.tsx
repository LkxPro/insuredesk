import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 角色权限 page: one flat role table where only the 管理员 (system) row is
 * locked — no rename/delete, checklist read-only — while every other role
 * offers the full edit surface, and the create/permissions dialogs fire their
 * mutations with the ticked permission points. Same faked-fetch tRPC pipeline
 * and useAuth-seam mock as the users-page tests.
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
    id: "u-me",
    username: "tester",
    name: "测试用户",
    email: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
  };
}

type RoleRow = {
  id: string;
  name: string;
  permissions: Permission[];
  system: boolean;
  userCount: number;
  createdAt: string;
};

const ADMIN_ROLE: RoleRow = {
  id: "r-admin",
  name: "管理员",
  permissions: [...TEST_ROLES.ADMIN.permissions],
  system: true,
  userCount: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
};

const QA_ROLE: RoleRow = {
  id: "r-qa",
  name: "质检专员",
  permissions: ["ticket.view", "ticket.view_all"],
  system: false,
  userCount: 0,
  createdAt: "2026-07-02T00:00:00.000Z",
};

const canned = { roles: [] as RoleRow[] };
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "role.list") {
    return canned.roles;
  }
  if (path === "role.create" || path === "role.rename") {
    const { name } = input as { name: string };
    return { id: "r-new", name };
  }
  if (path === "role.updatePermissions") {
    return { ...(input as object), name: "质检专员" };
  }
  if (path === "role.delete") {
    return input;
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

function renderRolesPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/roles"]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.ADMIN);
  auth.isLoading = false;
  canned.roles = [ADMIN_ROLE, QA_ROLE];
  calls = [];
});

describe("the role table", () => {
  it("is one flat list: only the 管理员 row is locked, every other role is editable", async () => {
    renderRolesPage();

    await screen.findByText("质检专员");
    // No 预设/自定义 classification — the only marker is the system badge
    expect(screen.queryByText("类型")).not.toBeInTheDocument();
    expect(screen.queryByText("预设")).not.toBeInTheDocument();
    expect(screen.queryByText("自定义")).not.toBeInTheDocument();
    expect(screen.getByText("系统")).toBeInTheDocument();

    // Only the non-system row offers 重命名/删除; the 管理员 row is view-only
    expect(screen.getAllByRole("button", { name: "重命名" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "查看权限" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "配置权限" })).toHaveLength(1);
  });

  it("role.view alone shows every checklist read-only and no mutating buttons", async () => {
    auth.user = userWith({ name: "仅看角色", permissions: ["role.view"] });
    renderRolesPage();

    await screen.findByText("质检专员");
    expect(screen.queryByRole("button", { name: "新增角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重命名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "查看权限" })).toHaveLength(2);
  });

  it("the 管理员 row opens the checklist read-only, ticked to its permissions", async () => {
    renderRolesPage();
    await screen.findByText("管理员");

    fireEvent.click(screen.getByRole("button", { name: "查看权限" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "查看权限" })).toBeInTheDocument();
    expect(within(dialog).getByText(/系统角色/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

    const box = within(dialog).getByRole("checkbox", { name: /访问工单列表/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
  });
});

describe("configuring roles", () => {
  it("新增角色 sends the name and the ticked permission points", async () => {
    renderRolesPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增角色" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("角色名称"), {
      target: { value: "外部审计" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /访问数据看板/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /访问工单列表/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "role.create")?.input).toEqual({
        name: "外部审计",
        permissions: ["dashboard.view", "ticket.view"],
      }),
    );
  });

  it("配置权限 starts from the role's current set and saves the delta", async () => {
    renderRolesPage();
    await screen.findByText("质检专员");

    fireEvent.click(screen.getByRole("button", { name: "配置权限" }));
    const dialog = await screen.findByRole("dialog");

    const already = within(dialog).getByRole("checkbox", { name: /访问工单列表/ });
    expect(already).toBeChecked();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /访问数据看板/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "role.updatePermissions")?.input).toEqual({
        id: "r-qa",
        permissions: ["ticket.view", "ticket.view_all", "dashboard.view"],
      }),
    );
  });

  it("删除 confirms first, then fires role.delete", async () => {
    renderRolesPage();
    await screen.findByText("质检专员");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(calls.some((call) => call.path === "role.delete")).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "role.delete")?.input).toEqual({
        id: "r-qa",
      }),
    );
  });

  it("a held role disables the destructive confirm and explains why", async () => {
    canned.roles = [ADMIN_ROLE, { ...QA_ROLE, userCount: 3 }];
    renderRolesPage();
    await screen.findByText("质检专员");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("button", { name: "确认删除" })).toBeDisabled();
    expect(screen.getByText(/仍有 3 个用户/)).toBeInTheDocument();
  });
});
