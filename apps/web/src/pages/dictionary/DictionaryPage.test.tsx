import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { TEST_ROLES } from "@/test/roles";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 字典管理 page: the 反馈渠道, 客诉类别 and 完结状态 catalogs behind
 * dictionary.manage, all rendered by the shared CatalogAdmin module. The
 * behavior suite exercises the module once (via 客诉类别); the per-catalog
 * smoke pins each catalog's config to its own tRPC namespace and wording.
 * Same faked-fetch tRPC pipeline and useAuth-seam mock as the sibling page
 * tests; the reference-deletion refusal is a server invariant covered by the
 * API integration tests — here the page just surfaces the CONFLICT message.
 */

const auth = vi.hoisted(() => ({ user: null as AuthUser | null, isLoading: false }));

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

const canned = {
  channels: [
    {
      id: "ch-baosi",
      name: "保司",
      active: true,
      displayOrder: 1,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
    {
      id: "ch-regulator",
      name: "监管",
      active: true,
      displayOrder: 2,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
  ],
  categories: [
    {
      id: "cat-claims",
      name: "理赔投诉",
      active: true,
      displayOrder: 1,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
    {
      id: "cat-visit",
      name: "回访问题",
      active: false,
      displayOrder: 2,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
  ],
  completionStatuses: [
    {
      id: "cs-normal",
      name: "正常完结",
      active: true,
      displayOrder: 1,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
    {
      id: "cs-cold",
      name: "冷处理",
      active: false,
      displayOrder: 2,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    },
  ],
};
let calls: Array<{ path: string; input: unknown }>;
let deleteError: string | null;

const lists: Record<string, unknown> = {
  "channel.list": canned.channels,
  "ticketCategory.list": canned.categories,
  "completionStatus.list": canned.completionStatuses,
};

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path in lists) return lists[path];
  const [, procedure] = path.split(".");
  if (procedure === "create") {
    return { id: "new", active: true, ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (procedure === "update") {
    return { active: true, ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (procedure === "setActive") {
    return { name: "目录项", displayOrder: 1, ...(input as object) };
  }
  if (procedure === "delete") {
    if (deleteError) throw new Error(deleteError);
    return input;
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
    try {
      return { result: { data: respond(path, procedureInput) } };
    } catch (error) {
      return { error: { message: (error as Error).message, code: -32600, data: {} } };
    }
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderPage(initialEntry = "/dictionary") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });
  return render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
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
  calls = [];
  deleteError = null;
});

describe("字典管理 page", () => {
  it("requires dictionary.manage: holders see the catalogs, others land on 403", async () => {
    renderPage();
    expect(await screen.findByText("保司")).toBeInTheDocument();
    expect(screen.getByText("理赔投诉")).toBeInTheDocument();
    expect(screen.getByText("正常完结")).toBeInTheDocument();
    expect(screen.getAllByText("已停用").length).toBeGreaterThan(0);
    expect(screen.getAllByText("启用").length).toBeGreaterThan(0);

    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderPage();
    expect(await screen.findByText("你没有访问该页面的权限")).toBeInTheDocument();
  });
});

describe("CatalogAdmin behavior (via 客诉类别)", () => {
  it("creates an entry with name and display order", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增类别" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("类别名称"), {
      target: { value: "新增测试类别" },
    });
    fireEvent.change(within(dialog).getByLabelText("显示顺序"), { target: { value: "18" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.create")?.input).toEqual({
        name: "新增测试类别",
        displayOrder: 18,
      }),
    );
  });

  it("maps schema validation errors onto the fields without calling the server", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增类别" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("显示顺序"), { target: { value: "1.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText("请填写类别名称")).toBeInTheDocument();
    expect(within(dialog).getByText("显示顺序必须为整数")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "ticketCategory.create")).toBe(false);
  });

  it("renames, toggles 停用/启用, and deletes through explicit controls", async () => {
    renderPage();
    await screen.findByText("理赔投诉");

    fireEvent.click(screen.getByRole("button", { name: "编辑 理赔投诉" }));
    const editDialog = await screen.findByRole("dialog");
    fireEvent.change(within(editDialog).getByLabelText("类别名称"), {
      target: { value: "理赔类投诉" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.update")?.input).toMatchObject({
        id: "cat-claims",
        name: "理赔类投诉",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "停用 理赔投诉" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.setActive")?.input).toEqual({
        id: "cat-claims",
        active: false,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "启用 回访问题" }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path === "ticketCategory.setActive").at(-1)?.input,
      ).toEqual({ id: "cat-visit", active: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除 回访问题" }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.delete")?.input).toEqual({
        id: "cat-visit",
      }),
    );
  });

  it("surfaces the server's reference-count refusal on delete", async () => {
    deleteError = "该类别已被 3 张工单使用，无法删除，可改为停用";
    renderPage();
    await screen.findByText("理赔投诉");

    fireEvent.click(screen.getByRole("button", { name: "删除 理赔投诉" }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));

    expect(
      await within(deleteDialog).findByText("该类别已被 3 张工单使用，无法删除，可改为停用"),
    ).toBeInTheDocument();
  });
});

describe("per-catalog config smoke", () => {
  it.each([
    {
      catalog: "反馈渠道",
      ns: "channel",
      addLabel: "新增渠道",
      nameLabel: "渠道名称",
      row: { id: "ch-baosi", name: "保司" },
      refusal: "该渠道已被 2 张工单使用，无法删除，可改为停用",
    },
    {
      catalog: "客诉类别",
      ns: "ticketCategory",
      addLabel: "新增类别",
      nameLabel: "类别名称",
      row: { id: "cat-claims", name: "理赔投诉" },
      refusal: "该类别已被 2 张工单使用，无法删除，可改为停用",
    },
    {
      catalog: "完结状态",
      ns: "completionStatus",
      addLabel: "新增完结状态",
      nameLabel: "状态名称",
      row: { id: "cs-normal", name: "正常完结" },
      refusal: "该完结状态已被 2 张工单使用，无法删除，可改为停用",
    },
  ])("$catalog wires every procedure to its own namespace", async (c) => {
    renderPage();
    await screen.findByText(c.row.name);

    fireEvent.click(screen.getByRole("button", { name: c.addLabel }));
    const createDialog = await screen.findByRole("dialog");
    fireEvent.change(within(createDialog).getByLabelText(c.nameLabel), {
      target: { value: "冒烟新增项" },
    });
    fireEvent.change(within(createDialog).getByLabelText("显示顺序"), { target: { value: "7" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.create`)?.input).toEqual({
        name: "冒烟新增项",
        displayOrder: 7,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: `编辑 ${c.row.name}` }));
    const editDialog = await screen.findByRole("dialog");
    fireEvent.change(within(editDialog).getByLabelText(c.nameLabel), {
      target: { value: "冒烟改名项" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.update`)?.input).toMatchObject({
        id: c.row.id,
        name: "冒烟改名项",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: `停用 ${c.row.name}` }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.setActive`)?.input).toEqual({
        id: c.row.id,
        active: false,
      }),
    );

    deleteError = c.refusal;
    fireEvent.click(screen.getByRole("button", { name: `删除 ${c.row.name}` }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    expect(await within(deleteDialog).findByText(c.refusal)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.delete`)?.input).toEqual({
        id: c.row.id,
      }),
    );
  });
});
