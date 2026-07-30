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
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
    isExternal: false,
  };
}

type ShiftRow = {
  id: string;
  name: string;
  color: string;
  segments: Array<{ start: string; end: string }>;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

const canned = {
  shifts: [
    {
      id: "early",
      name: "早班",
      color: "#10b981",
      segments: [{ start: "09:00", end: "13:00" }],
      displayOrder: 1,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    },
    {
      id: "rest",
      name: "休",
      color: "#9ca3af",
      segments: [],
      displayOrder: 99,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    },
  ] satisfies ShiftRow[],
};
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "shiftType.list") return canned.shifts;
  if (path === "shiftType.create") {
    return { id: "new", ...(input as object), createdAt: "", updatedAt: "" };
  }
  if (path === "shiftType.update") return { ...(input as object), createdAt: "", updatedAt: "" };
  if (path === "shiftType.delete") return input;
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
    return { result: { data: respond(path, procedureInput) } };
  });
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });
  return render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/shift-types"]}>
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
});

describe("班次管理 page", () => {
  it("renders ordered definitions, their colors and rest-day semantics", async () => {
    renderPage();

    expect(await screen.findByText("早班")).toBeInTheDocument();
    expect(screen.getByText("09:00–13:00")).toBeInTheDocument();
    expect(screen.getByText("休息日（无时段）")).toBeInTheDocument();
    expect(screen.getByLabelText("早班颜色")).toHaveStyle({ backgroundColor: "#10b981" });
  });

  it("creates a new overnight multi-segment shift", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新增班次" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("班次名称"), { target: { value: "夜班" } });
    fireEvent.change(within(dialog).getByLabelText("班次颜色"), { target: { value: "#7c3aed" } });
    fireEvent.change(within(dialog).getByLabelText("显示顺序"), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加时段" }));
    const starts = within(dialog).getAllByLabelText("开始时间");
    const ends = within(dialog).getAllByLabelText("结束时间");
    fireEvent.change(starts[0] as HTMLElement, { target: { value: "18:00" } });
    fireEvent.change(ends[0] as HTMLElement, { target: { value: "02:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加时段" }));
    fireEvent.change(within(dialog).getAllByLabelText("开始时间")[1] as HTMLElement, {
      target: { value: "03:00" },
    });
    fireEvent.change(within(dialog).getAllByLabelText("结束时间")[1] as HTMLElement, {
      target: { value: "05:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "shiftType.create")?.input).toEqual({
        name: "夜班",
        color: "#7c3aed",
        displayOrder: 4,
        segments: [
          { start: "18:00", end: "02:00" },
          { start: "03:00", end: "05:00" },
        ],
      }),
    );
  });

  it("edits and deletes a definition through explicit dialogs", async () => {
    renderPage();
    await screen.findByText("早班");

    fireEvent.click(screen.getByRole("button", { name: "编辑 早班" }));
    const editDialog = await screen.findByRole("dialog");
    fireEvent.change(within(editDialog).getByLabelText("班次名称"), {
      target: { value: "晨班" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "shiftType.update")?.input).toMatchObject({
        id: "early",
        name: "晨班",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除 休" }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "shiftType.delete")?.input).toEqual({ id: "rest" }),
    );
  });
});
