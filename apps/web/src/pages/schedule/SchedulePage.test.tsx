import type { Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
});

function userWith(permissions: Permission[]): AuthUser {
  return {
    id: "viewer",
    username: "viewer",
    name: "排班测试员",
    email: null,
    team: null,
    roleId: "role",
    roleName: "排班角色",
    permissions,
    requiredTicketFields: [],
    isExternal: false,
  };
}

const TODAY = format(new Date(), "yyyy-MM-dd");
const TOMORROW = format(new Date(new Date().setDate(new Date().getDate() + 1)), "yyyy-MM-dd");

const canned = {
  grid: {
    users: [
      { id: "zhang", name: "张客服", username: "zhang", active: true },
      { id: "wang", name: "王客服", username: "wang", active: true },
      { id: "retired", name: "停用客服", username: "retired", active: false },
    ],
    shifts: [
      {
        id: "early",
        name: "早班",
        color: "#10b981",
        segments: [{ start: "09:00", end: "13:00" }],
        displayOrder: 1,
      },
      {
        id: "full",
        name: "全班",
        color: "#3b82f6",
        segments: [{ start: "09:00", end: "18:00" }],
        displayOrder: 3,
      },
      { id: "rest", name: "休", color: "#9ca3af", segments: [], displayOrder: 99 },
    ],
    entries: [
      {
        id: "schedule-1",
        date: TODAY,
        userId: "zhang",
        userName: "张客服",
        username: "zhang",
        userActive: true,
        shiftId: "early",
        shiftName: "早班",
        shiftColor: "#10b981",
        shiftSegments: [{ start: "09:00", end: "13:00" }],
        remark: null,
      },
      {
        id: "schedule-retired",
        date: TODAY,
        userId: "retired",
        userName: "停用客服",
        username: "retired",
        userActive: false,
        shiftId: "full",
        shiftName: "全班",
        shiftColor: "#3b82f6",
        shiftSegments: [{ start: "09:00", end: "18:00" }],
        remark: null,
      },
    ],
  },
};
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "schedule.list") return canned.grid;
  if (path === "schedule.create") {
    const payload = input as { date: string; userId: string; shiftId: string };
    return { id: "new-schedule", ...payload, remark: null };
  }
  if (path === "schedule.delete") return input;
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
          <MemoryRouter initialEntries={["/schedule"]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER.permissions as Permission[]);
  calls = [];
});

describe("schedule grid", () => {
  it("contains the wide date grid inside the available content width", async () => {
    renderPage();

    const heading = await screen.findByRole("heading", { name: "排班表" });
    const page = heading.closest(".flex.flex-1.flex-col");
    const table = await screen.findByRole("table");
    const content = page?.parentElement;
    const inset = content?.parentElement;
    const tableFrame = table.parentElement?.parentElement;

    expect(page).toHaveClass("min-w-0", "max-w-full");
    expect(content).toHaveClass("min-w-0");
    expect(inset).toHaveAttribute("data-slot", "sidebar-inset");
    expect(inset).toHaveClass("min-w-0");
    expect(tableFrame).toHaveClass("min-w-0", "max-w-full");
    expect(table.parentElement).toHaveClass("w-full", "overflow-x-auto");
  });

  it("loads this month and renders people as rows, dates as columns, and colored shifts", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "排班表" })).toBeInTheDocument();
    expect(await screen.findByText("张客服")).toBeInTheDocument();
    expect(screen.getByText("王客服")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: new RegExp(TODAY.slice(-2)) }),
    ).toBeInTheDocument();
    const earlyCell = screen.getByRole("button", { name: `设置 张客服 ${TODAY} 排班：早班` });
    expect(within(earlyCell).getByText("早班")).toHaveStyle({
      backgroundColor: "#10b981",
    });

    expect(calls.find((call) => call.path === "schedule.list")?.input).toEqual({
      startDate: format(startOfMonth(new Date()), "yyyy-MM-dd"),
      endDate: format(endOfMonth(new Date()), "yyyy-MM-dd"),
    });
  });

  it("switches to the week preset and exposes a custom date-range calendar", async () => {
    renderPage();
    await screen.findByText("张客服");

    fireEvent.click(screen.getByRole("radio", { name: "本周" }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path === "schedule.list" &&
            JSON.stringify(call.input) ===
              JSON.stringify({
                startDate: format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
                endDate: format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
              }),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "自定义日期范围" }));
    expect(await screen.findAllByRole("grid")).toHaveLength(2);
  });

  it("sets a shift from an empty cell and clears an existing cell", async () => {
    renderPage();
    await screen.findByText("张客服");

    const emptyCell = screen.getByRole("button", { name: `设置 王客服 ${TOMORROW} 排班：未排班` });
    fireEvent.pointerDown(emptyCell, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(emptyCell);
    fireEvent.click(await screen.findByRole("menuitem", { name: "全班 09:00–18:00" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "schedule.create")?.input).toEqual({
        date: TOMORROW,
        userId: "wang",
        shiftId: "full",
        remark: null,
      }),
    );

    const existingCell = screen.getByRole("button", { name: `设置 张客服 ${TODAY} 排班：早班` });
    fireEvent.pointerDown(existingCell, { button: 0, ctrlKey: false, pointerId: 2 });
    fireEvent.click(existingCell);
    fireEvent.click(await screen.findByRole("menuitem", { name: "清除排班" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "schedule.delete")?.input).toEqual({
        id: "schedule-1",
      }),
    );
  });

  it("keeps the grid read-only without schedule.edit", async () => {
    auth.user = userWith(["schedule.view"]);
    renderPage();

    await screen.findByText("张客服");
    expect(screen.queryByRole("button", { name: /设置 张客服/ })).not.toBeInTheDocument();
    expect(screen.getByText("早班")).toBeInTheDocument();
  });

  it("lets editors clear an existing schedule for an inactive user without assigning a new shift", async () => {
    renderPage();
    await screen.findByText("停用客服");

    const cell = screen.getByRole("button", { name: `清除 停用客服 ${TODAY} 排班：全班` });
    fireEvent.pointerDown(cell, { button: 0, ctrlKey: false, pointerId: 3 });
    fireEvent.click(cell);

    expect(screen.queryByRole("menuitem", { name: "早班 09:00–13:00" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("menuitem", { name: "清除排班" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "schedule.delete")?.input).toEqual({
        id: "schedule-retired",
      }),
    );
  });
});
