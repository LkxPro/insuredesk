import type { AuthUser } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import {
  COMPLAINT_LEVELS,
  DEFAULT_SLA_POLICIES,
  PRESET_ROLES,
  type Permission,
} from "@insuredesk/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../AppRoutes";
import { ThemeProvider } from "../../components/ThemeProvider";

/**
 * SLA 策略 page: one card per complaint level, 编辑 only with
 * sla.edit, and the editor dialog mirrors slaPolicyUpdateInputSchema — the
 * 保存 button refuses positive-integer violations and an advanceMinutes at or
 * past its own checkpoint, and ships parsed numbers (or null for 不设超时).
 * Same faked-fetch tRPC pipeline and useAuth-seam mock as the roles-page
 * tests.
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

const POLICIES = COMPLAINT_LEVELS.map((level) => ({
  complaintLevel: level,
  firstResponseMinutes: DEFAULT_SLA_POLICIES[level].firstResponseMinutes,
  overdueHours: DEFAULT_SLA_POLICIES[level].overdueHours,
  reminderRules: DEFAULT_SLA_POLICIES[level].reminderRules,
  updatedAt: "2026-07-01T00:00:00.000Z",
}));

let calls: Array<{ path: string; input: unknown }>;

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "sla.list") {
    return POLICIES;
  }
  if (path === "sla.update") {
    return { ...(input as object), updatedAt: "2026-07-10T00:00:00.000Z" };
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

function renderSlaPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "http://localhost/api/trpc", fetch: fakeFetch })],
  });

  return render(
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/sla"]}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

/** Indexed lookup that satisfies noUncheckedIndexedAccess. */
function nth(elements: HTMLElement[], index: number): HTMLElement {
  const element = elements[index];
  if (element === undefined) {
    throw new Error(`expected an element at index ${index}, got ${elements.length}`);
  }
  return element;
}

/** Open the 编辑 dialog for the given level (cards render in enum order). */
async function openEditDialog(level: (typeof COMPLAINT_LEVELS)[number]) {
  await screen.findByText(level);
  const index = COMPLAINT_LEVELS.indexOf(level);
  fireEvent.click(nth(screen.getAllByRole("button", { name: "编辑" }), index));
  return await screen.findByRole("dialog");
}

beforeEach(() => {
  auth.user = userWith(PRESET_ROLES.ADMIN);
  auth.isLoading = false;
  calls = [];
});

describe("the SLA policy cards", () => {
  it("renders one card per level with its 首响/超时/规则 facts", async () => {
    renderSlaPage();

    for (const level of COMPLAINT_LEVELS) {
      expect(await screen.findByText(level)).toBeInTheDocument();
    }
    // 管理员 (sla.edit) sees one 编辑 per card
    expect(screen.getAllByRole("button", { name: "编辑" })).toHaveLength(4);
    // 特急投诉 has no deadline and the rolling rule
    expect(screen.getByText("不设超时")).toBeInTheDocument();
    expect(screen.getByText(/每满 12 小时提醒/)).toBeInTheDocument();
    // 一般投诉's first checkpoint rendered as prose
    expect(
      screen.getAllByText(/24 小时内累计跟进 (1|2) 次，提前 60 分钟提醒/).length,
    ).toBeGreaterThan(0);
  });

  it("sla.view alone renders the cards read-only", async () => {
    auth.user = userWith({ name: "只读观察", permissions: ["sla.view"] });
    renderSlaPage();

    await screen.findByText("一般投诉");
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });
});

describe("editing a policy", () => {
  it("保存 sends parsed numbers and the untouched rule list for the edited level", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    fireEvent.change(within(dialog).getByLabelText("首响违约线（分钟）"), {
      target: { value: "90" },
    });
    fireEvent.change(within(dialog).getByLabelText("超时时长（小时）"), {
      target: { value: "24" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.update")?.input).toEqual({
        complaintLevel: "一般投诉",
        firstResponseMinutes: 90,
        overdueHours: 24,
        reminderRules: DEFAULT_SLA_POLICIES.一般投诉.reminderRules,
      }),
    );
  });

  it("不设超时 disables the hours input and sends overdueHours = null", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    fireEvent.click(within(dialog).getByLabelText("不设超时"));
    expect(within(dialog).getByLabelText("超时时长（小时）")).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.update")?.input).toMatchObject({
        complaintLevel: "一般投诉",
        overdueHours: null,
      }),
    );
  });

  it("增删规则 reach the payload: delete the 24h checkpoint, add a 6h rolling rule", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    // Two seeded checkpoints; drop the first (24h)
    fireEvent.click(nth(within(dialog).getAllByRole("button", { name: "删除" }), 0));
    fireEvent.click(within(dialog).getByRole("button", { name: "添加滚动提醒" }));
    fireEvent.change(within(dialog).getByLabelText("跟进间隔（小时）"), {
      target: { value: "6" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.update")?.input).toMatchObject({
        complaintLevel: "一般投诉",
        reminderRules: [
          {
            type: "follow_up_checkpoint",
            checkpointHours: 48,
            requiredCount: 2,
            advanceMinutes: 180,
          },
          { type: "rolling_follow_up", intervalHours: 6 },
        ],
      }),
    );
  });

  it("advanceMinutes at or past its checkpoint marks the field and blocks 保存", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    // First checkpoint: 24h / advance 60min → shrink the checkpoint to 1h so
    // the 60min advance now equals the whole window
    fireEvent.change(nth(within(dialog).getAllByLabelText("检查点（小时）"), 0), {
      target: { value: "1" },
    });
    expect(await within(dialog).findByText("提前提醒必须小于检查点时长")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
    expect(calls.some((call) => call.path === "sla.update")).toBe(false);

    // Fixing the advance below the checkpoint re-enables saving
    fireEvent.change(nth(within(dialog).getAllByLabelText("提前提醒（分钟）"), 0), {
      target: { value: "30" },
    });
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("non-numeric and zero inputs are refused as 正整数 violations", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    fireEvent.change(within(dialog).getByLabelText("首响违约线（分钟）"), {
      target: { value: "0" },
    });
    expect(await within(dialog).findByText("需为正整数（分钟）")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("超时时长（小时）"), {
      target: { value: "abc" },
    });
    expect(await within(dialog).findByText("需为正整数（小时）")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
