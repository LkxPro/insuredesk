import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 用户管理 page: the account table renders role/state, operation buttons
 * appear only with their own permission points (mirroring the API guards),
 * and the dialogs fire the right mutations. Same faked-fetch tRPC pipeline
 * and useAuth-seam mock as the schedule-page tests.
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

// Radix Select drives its dropdown with pointer-capture and scroll APIs that
// jsdom doesn't implement.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

function userWith(role: { name: string; permissions: readonly Permission[] }): AuthUser {
  return {
    id: "u-me",
    username: "tester",
    name: "测试用户",
    email: null,
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
  };
}

type UserRow = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  team: string | null;
  active: boolean;
  roleId: string;
  roleName: string;
  roleSystem: boolean;
  roleExternal: boolean;
  externalOrgId: string | null;
  externalOrgName: string | null;
  createdAt: string;
};

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "u-zhang",
    username: "cs1",
    name: "张客服",
    email: "cs1@insuredesk.local",
    team: null,
    active: true,
    roleId: "r-frontline",
    roleName: "一线客服",
    roleSystem: false,
    roleExternal: false,
    externalOrgId: null,
    externalOrgName: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** An 外部用户 row: external role plus the org it is bound to. */
function externalRow(overrides: Partial<UserRow> = {}): UserRow {
  return row({
    id: "u-wai",
    username: "ext1",
    name: "外部小王",
    email: null,
    roleId: "r-external",
    roleName: "外部用户",
    roleExternal: true,
    externalOrgId: "org-a",
    externalOrgName: "外包客服A",
    ...overrides,
  });
}

const ROLE_OPTIONS = [
  { id: "r-frontline", name: "一线客服", system: false, external: false },
  { id: "r-custom", name: "质检专员", system: false, external: false },
  { id: "r-external", name: "外部用户", system: false, external: true },
];

const ORG_OPTIONS = [
  { id: "org-a", name: "外包客服A", active: true },
  { id: "org-b", name: "合作伙伴B", active: true },
  { id: "org-dead", name: "已停用机构", active: false },
];

const canned = { users: [] as UserRow[] };
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "user.list") {
    return canned.users;
  }
  if (path === "user.roleOptions") {
    return ROLE_OPTIONS;
  }
  if (path === "user.externalOrgOptions") {
    return ORG_OPTIONS;
  }
  if (path === "user.create" || path === "user.update") {
    const { name } = input as { name: string };
    return { id: "u-new", name };
  }
  if (path === "user.setActive") {
    return { ...(input as object), name: "张客服" };
  }
  if (path === "user.assignRole") {
    return { id: "u-zhang", name: "张客服", roleName: "质检专员" };
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

function renderUsersPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/users"]}>
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
  canned.users = [];
  calls = [];
});

describe("the account table", () => {
  it("renders accounts with role, state, and disabled styling", async () => {
    canned.users = [
      row(),
      row({
        id: "u-gone",
        username: "leaver",
        name: "李离职",
        active: false,
        roleId: "r-custom",
        roleName: "质检专员",
        roleSystem: false,
      }),
    ];
    renderUsersPage();

    await screen.findByText("张客服");
    expect(screen.getByText("李离职")).toBeInTheDocument();
    expect(screen.getByText("已禁用")).toBeInTheDocument();
    expect(screen.getByText("质检专员")).toBeInTheDocument();
    // Disabled rows offer 启用, active rows offer 禁用
    expect(screen.getAllByRole("button", { name: "禁用" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "启用" })).toHaveLength(1);
  });

  it("user.view alone shows a read-only table — no create, no row actions", async () => {
    auth.user = userWith({ name: "仅看用户", permissions: ["user.view"] });
    canned.users = [row()];
    renderUsersPage();

    await screen.findByText("张客服");
    expect(screen.queryByRole("button", { name: "新增用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分配角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "禁用" })).not.toBeInTheDocument();
  });

  it("never offers disabling your own account", async () => {
    canned.users = [row({ id: "u-me", username: "tester", name: "测试用户" }), row()];
    renderUsersPage();

    await screen.findByText("张客服");
    // Exactly one 禁用 — for 张客服, not for the operator's own row
    expect(screen.getAllByRole("button", { name: "禁用" })).toHaveLength(1);
  });
});

describe("operations", () => {
  it("新增用户 submits the form through user.create", async () => {
    renderUsersPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增用户" }));

    await screen.findByRole("heading", { name: "新增用户" });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "王新人" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "newbie" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "secret-123" } });

    const trigger = screen.getByRole("combobox", { name: "角色" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "质检专员" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "user.create")?.input).toMatchObject({
        username: "newbie",
        password: "secret-123",
        name: "王新人",
        roleId: "r-custom",
      }),
    );
  });

  it("禁用 asks for confirmation before firing user.setActive", async () => {
    canned.users = [row()];
    renderUsersPage();

    fireEvent.click(await screen.findByRole("button", { name: "禁用" }));
    // Nothing fired yet — the dialog is the only path to the mutation
    expect(calls.some((call) => call.path === "user.setActive")).toBe(false);
    expect(await screen.findByRole("heading", { name: "禁用用户" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认禁用" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "user.setActive")?.input).toEqual({
        id: "u-zhang",
        active: false,
      }),
    );
  });

  it("分配角色 preselects the current role and fires user.assignRole", async () => {
    canned.users = [row()];
    renderUsersPage();

    fireEvent.click(await screen.findByRole("button", { name: "分配角色" }));
    await screen.findByRole("heading", { name: "分配角色" });

    const trigger = screen.getByRole("combobox", { name: "角色" });
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveTextContent("一线客服");
    // Confirm stays disabled until the pick actually changes
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "质检专员" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "user.assignRole")?.input).toMatchObject({
        id: "u-zhang",
        roleId: "r-custom",
      }),
    );
  });
});

describe("外部机构选择器", () => {
  /** Pick a Radix Select option: pointerDown opens, click commits. */
  async function pick(comboboxName: string, optionName: string) {
    const trigger = screen.getByRole("combobox", { name: comboboxName });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: optionName }));
  }

  it("新增用户 shows the org picker only for an 外部角色", async () => {
    renderUsersPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增用户" }));
    await screen.findByRole("heading", { name: "新增用户" });

    expect(screen.queryByRole("combobox", { name: "所属外部机构" })).not.toBeInTheDocument();

    await pick("角色", "外部用户");
    expect(await screen.findByRole("combobox", { name: "所属外部机构" })).toBeInTheDocument();

    // Back to an internal role: the picker disappears again
    await pick("角色", "一线客服");
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "所属外部机构" })).not.toBeInTheDocument(),
    );
  });

  it("新增外部账号 submits roleId + externalOrgId", async () => {
    renderUsersPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增用户" }));
    await screen.findByRole("heading", { name: "新增用户" });

    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "外部小王" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "ext-wang" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "secret-123" } });
    await pick("角色", "外部用户");
    await pick("所属外部机构", "合作伙伴B");
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "user.create")?.input).toMatchObject({
        username: "ext-wang",
        roleId: "r-external",
        externalOrgId: "org-b",
      }),
    );
  });

  it("角色切回内部时清空已选机构", async () => {
    renderUsersPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增用户" }));
    await screen.findByRole("heading", { name: "新增用户" });

    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "改主意" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "flip-flop" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "secret-123" } });
    await pick("角色", "外部用户");
    await pick("所属外部机构", "外包客服A");
    await pick("角色", "一线客服");
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(calls.some((call) => call.path === "user.create")).toBe(true));
    // The shared schema normalizes an empty pick to null before it hits the wire
    expect(calls.find((call) => call.path === "user.create")?.input).toMatchObject({
      roleId: "r-frontline",
      externalOrgId: null,
    });
  });

  it("编辑用户 offers the picker for external accounts, preselected", async () => {
    canned.users = [externalRow()];
    renderUsersPage();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByRole("heading", { name: "编辑用户" });

    const trigger = await screen.findByRole("combobox", { name: "所属外部机构" });
    await waitFor(() => expect(trigger).toHaveTextContent("外包客服A"));

    await pick("所属外部机构", "合作伙伴B");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "user.update")?.input).toMatchObject({
        id: "u-wai",
        externalOrgId: "org-b",
      }),
    );
  });

  it("编辑内部账号时没有机构选择器", async () => {
    canned.users = [row()];
    renderUsersPage();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByRole("heading", { name: "编辑用户" });
    expect(screen.queryByRole("combobox", { name: "所属外部机构" })).not.toBeInTheDocument();
  });

  it("停用的机构不作为新选项出现", async () => {
    canned.users = [externalRow()];
    renderUsersPage();

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    await screen.findByRole("heading", { name: "编辑用户" });

    const trigger = await screen.findByRole("combobox", { name: "所属外部机构" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);

    await screen.findByRole("option", { name: "合作伙伴B" });
    expect(screen.queryByRole("option", { name: /已停用机构/ })).not.toBeInTheDocument();
  });

  it("分配角色 到外部角色时必须先选机构", async () => {
    canned.users = [row()];
    renderUsersPage();

    fireEvent.click(await screen.findByRole("button", { name: "分配角色" }));
    await screen.findByRole("heading", { name: "分配角色" });

    await pick("角色", "外部用户");
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    await pick("所属外部机构", "外包客服A");
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "user.assignRole")?.input).toMatchObject({
        id: "u-zhang",
        roleId: "r-external",
        externalOrgId: "org-a",
      }),
    );
  });

  it("外部账号在表格里显示所属机构", async () => {
    canned.users = [externalRow()];
    renderUsersPage();

    await screen.findByText("外部小王");
    expect(screen.getByText("外包客服A")).toBeInTheDocument();
  });
});
