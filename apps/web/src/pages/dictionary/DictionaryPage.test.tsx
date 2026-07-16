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
 * 渠道与类别 page (issues #68/#69): the 反馈渠道 and 客诉类别 catalogs behind
 * dictionary.manage. Same faked-fetch tRPC pipeline and useAuth-seam mock as
 * the sibling page tests; the reference-deletion refusal is a server
 * invariant covered by the API integration tests — here the page just
 * surfaces the CONFLICT message.
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
};
let calls: Array<{ path: string; input: unknown }>;
let deleteError: string | null;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "ticketCategory.list") return canned.categories;
  if (path === "ticketCategory.create") {
    return { id: "new", active: true, ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (path === "ticketCategory.update") {
    return { active: true, ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (path === "ticketCategory.setActive") {
    return { id: "cat-visit", name: "回访问题", displayOrder: 2, ...(input as object) };
  }
  if (path === "ticketCategory.delete") {
    if (deleteError) throw new Error(deleteError);
    return input;
  }
  if (path === "channel.list") return canned.channels;
  if (path === "channel.create") {
    return { id: "new", active: true, ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (path === "channel.update") {
    return { active: true, ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (path === "channel.setActive") {
    return {
      id: "ch-baosi",
      name: "保司",
      displayOrder: 1,
      ...(input as object),
    };
  }
  if (path === "channel.delete") {
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

describe("渠道与类别 page", () => {
  it("requires dictionary.manage: holders see the catalog, others land on 403", async () => {
    renderPage();
    expect(await screen.findByText("理赔投诉")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getAllByText("启用").length).toBeGreaterThan(0);

    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderPage();
    expect(await screen.findByText("你没有访问该页面的权限")).toBeInTheDocument();
  });

  it("creates a category with name and display order", async () => {
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

  it("creates a channel with name and display order", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增渠道" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("渠道名称"), {
      target: { value: "监管转办" },
    });
    fireEvent.change(within(dialog).getByLabelText("显示顺序"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "channel.create")?.input).toEqual({
        name: "监管转办",
        displayOrder: 5,
      }),
    );
  });

  it("renames a channel through the edit dialog", async () => {
    renderPage();
    await screen.findByText("监管");

    fireEvent.click(screen.getByRole("button", { name: "编辑 监管" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("渠道名称"), {
      target: { value: "监管转办" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "channel.update")?.input).toEqual({
        id: "ch-regulator",
        name: "监管转办",
        displayOrder: 2,
      }),
    );
  });

  it("toggles 停用/启用 and deletes a channel; the server refusal surfaces in the dialog", async () => {
    renderPage();
    await screen.findByText("保司");

    fireEvent.click(screen.getByRole("button", { name: "停用 保司" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "channel.setActive")?.input).toEqual({
        id: "ch-baosi",
        active: false,
      }),
    );

    deleteError = "该渠道已被 2 张工单使用，无法删除，可改为停用";
    fireEvent.click(screen.getByRole("button", { name: "删除 保司" }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    expect(
      await within(deleteDialog).findByText("该渠道已被 2 张工单使用，无法删除，可改为停用"),
    ).toBeInTheDocument();
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
