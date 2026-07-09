import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { PRESET_ROLES, type Permission } from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { format } from "date-fns";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * 排班配置 page (issue #31): the 渠道 × 班次 grid renders one day's roster,
 * add/remove exist only with schedule.edit (mirroring the API guards), and
 * the add dialog fires schedule.create with the addressed cell. Same
 * faked-fetch tRPC pipeline and useAuth-seam mock as the tickets-page tests.
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
    id: "u1",
    username: "tester",
    name: "测试用户",
    email: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
  };
}

/** The page opens on today — roster entries must carry today's date. */
const TODAY = format(new Date(), "yyyy-MM-dd");

type ScheduleEntry = {
  id: string;
  date: string;
  shift: string;
  startTime: string;
  endTime: string;
  channel: string;
  remark: string | null;
  userId: string;
  userName: string;
  userActive: boolean;
};

function entry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: "s1",
    date: TODAY,
    shift: "day",
    startTime: "09:00",
    endTime: "18:00",
    channel: "保司",
    remark: null,
    userId: "u-zhang",
    userName: "张客服",
    userActive: true,
    ...overrides,
  };
}

const DUTY_USERS = [
  { id: "u-zhang", name: "张客服", username: "cs1" },
  { id: "u-wang", name: "王二客服", username: "cs2" },
];

const canned = { entries: [] as ScheduleEntry[] };
let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0 };
  }
  if (path === "schedule.list") {
    return canned.entries;
  }
  if (path === "schedule.dutyUserOptions") {
    return DUTY_USERS;
  }
  if (path === "schedule.create") {
    const { userId } = input as { userId: string };
    return {
      id: "s-new",
      userName: DUTY_USERS.find((user) => user.id === userId)?.name ?? "",
    };
  }
  if (path === "schedule.delete") {
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

function renderSchedulePage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
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
  auth.user = userWith(PRESET_ROLES.CS_MANAGER);
  auth.isLoading = false;
  canned.entries = [];
  calls = [];
});

describe("the 渠道 × 班次 grid", () => {
  it("renders all four channels, both shift windows, and today's entries in place", async () => {
    canned.entries = [
      entry(),
      entry({ id: "s2", shift: "night", userId: "u-wang", userName: "王二客服" }),
    ];
    renderSchedulePage();

    await screen.findByText("张客服");
    expect(screen.getByText("王二客服")).toBeInTheDocument();
    for (const channel of ["保司", "经纪", "支付", "监管"]) {
      expect(screen.getByText(channel)).toBeInTheDocument();
    }
    expect(screen.getByText("早班")).toBeInTheDocument();
    expect(screen.getByText("09:00–18:00")).toBeInTheDocument();
    expect(screen.getByText("晚班")).toBeInTheDocument();
    expect(screen.getByText("12:00–21:00")).toBeInTheDocument();
  });

  it("schedule.view without schedule.edit shows the roster read-only", async () => {
    auth.user = userWith({ name: "仅看排班", permissions: ["schedule.view"] });
    canned.entries = [entry()];
    renderSchedulePage();

    await screen.findByText("张客服");
    expect(screen.queryByRole("button", { name: "添加" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /移除/ })).not.toBeInTheDocument();
    // Empty cells say so instead of offering an add action
    expect(screen.getAllByText("无排班").length).toBeGreaterThan(0);
  });
});

describe("editing the roster", () => {
  it("添加 opens the dialog addressed to the clicked cell and fires schedule.create", async () => {
    renderSchedulePage();
    await screen.findAllByRole("button", { name: "添加" });

    // 8 cells: 4 channels × 2 shifts; the first is 保司 × 早班
    const addButtons = screen.getAllByRole("button", { name: "添加" });
    expect(addButtons).toHaveLength(8);
    fireEvent.click(addButtons[0] as HTMLElement);

    expect(await screen.findByRole("heading", { name: "添加值班人" })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${TODAY} · 早班（09:00–18:00） · 保司渠道`)),
    ).toBeInTheDocument();

    const trigger = screen.getByRole("combobox", { name: "值班人" });
    // The picker stays disabled until dutyUserOptions lands
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "王二客服" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "schedule.create")?.input).toEqual({
        date: TODAY,
        shift: "day",
        channel: "保司",
        userId: "u-wang",
        remark: null,
      }),
    );
  });

  it("the badge's remove button fires schedule.delete with the entry id", async () => {
    canned.entries = [entry()];
    renderSchedulePage();

    fireEvent.click(await screen.findByRole("button", { name: "移除 张客服" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "schedule.delete")?.input).toEqual({ id: "s1" }),
    );
  });

  it("day navigation queries the shifted date", async () => {
    renderSchedulePage();
    await screen.findAllByRole("button", { name: "添加" });

    fireEvent.click(screen.getByRole("button", { name: "前一天" }));

    const yesterday = new Date(`${TODAY}T00:00:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path === "schedule.list" &&
            (call.input as { date: string }).date === format(yesterday, "yyyy-MM-dd"),
        ),
      ).toBe(true),
    );
  });
});
