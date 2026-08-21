import type { Permission, ReminderRule } from "@insuredesk/shared";
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
    team: null,
    roleId: "r1",
    roleName: role.name,
    permissions: [...role.permissions],
    requiredTicketFields: [],
    isExternal: false,
  };
}

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  firstResponseMinutes: number;
  overdueHours: number | null;
  reminderRules: ReminderRule[];
  updatedAt: string;
}

function policy(
  partial: Partial<PolicyRow> & Pick<PolicyRow, "id" | "name" | "sortOrder">,
): PolicyRow {
  return {
    description: null,
    active: true,
    firstResponseMinutes: 120,
    overdueHours: 48,
    reminderRules: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

const FACTORY: PolicyRow[] = [
  policy({
    id: "p-normal",
    name: "一般投诉",
    sortOrder: 1,
    description: "常规投诉：48 小时处理时限。",
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 1, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 2, advanceMinutes: 180 },
    ],
  }),
  policy({
    id: "p-high",
    name: "高级投诉",
    sortOrder: 2,
    description: "重要投诉：48 小时处理时限。",
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 1, advanceMinutes: 60 },
      { type: "follow_up_checkpoint", checkpointHours: 48, requiredCount: 3, advanceMinutes: 180 },
    ],
  }),
  policy({
    id: "p-urgent",
    name: "加急投诉",
    sortOrder: 3,
    description: "加急投诉：72 小时处理时限。",
    firstResponseMinutes: 60,
    overdueHours: 72,
    reminderRules: [
      { type: "follow_up_checkpoint", checkpointHours: 24, requiredCount: 2, advanceMinutes: 60 },
    ],
  }),
  policy({
    id: "p-critical",
    name: "特急投诉",
    sortOrder: 4,
    description: "特急投诉：不设处理时限。",
    firstResponseMinutes: 30,
    overdueHours: null,
    reminderRules: [{ type: "rolling_follow_up", intervalHours: 12 }],
  }),
  policy({
    id: "p-vip",
    name: "VIP 专线",
    sortOrder: 5,
    description: "VIP 客户专属通道。",
    active: false,
    firstResponseMinutes: 15,
    overdueHours: 4,
    reminderRules: [{ type: "rolling_follow_up", intervalHours: 1 }],
  }),
];

let db: PolicyRow[];
let createSeq: number;
let calls: Array<{ path: string; input: unknown }>;

/** 撞名（含停用行）走服务端同一份语义：全表唯一。 */
function nameTaken(name: string, exceptId?: string): boolean {
  return db.some((row) => row.name === name && row.id !== exceptId);
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { trpcCode: "CONFLICT" });
}

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path === "sla.list") {
    return [...db].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  if (path === "sla.create") {
    const payload = input as Omit<PolicyRow, "id" | "sortOrder" | "active" | "updatedAt">;
    if (nameTaken(payload.name)) {
      conflict(`时效策略「${payload.name}」名称已存在`);
    }
    createSeq += 1;
    const row: PolicyRow = {
      ...payload,
      description: payload.description ?? null,
      id: `p-new-${createSeq}`,
      sortOrder: Math.max(...db.map((row) => row.sortOrder)) + 1,
      active: true,
      updatedAt: "2026-08-17T00:00:00.000Z",
    };
    db.push(row);
    return row;
  }
  if (path === "sla.update") {
    const payload = input as Partial<PolicyRow> & { id: string };
    const row = db.find((item) => item.id === payload.id);
    if (!row) {
      throw new Error(`unknown policy id ${payload.id}`);
    }
    if (payload.name !== undefined && nameTaken(payload.name, payload.id)) {
      conflict(`时效策略「${payload.name}」名称已存在`);
    }
    for (const key of [
      "name",
      "description",
      "firstResponseMinutes",
      "overdueHours",
      "reminderRules",
    ] as const) {
      if (payload[key] !== undefined) {
        Object.assign(row, { [key]: payload[key] });
      }
    }
    return row;
  }
  if (path === "sla.sort") {
    const { policyIds } = input as { policyIds: string[] };
    for (const [index, id] of policyIds.entries()) {
      const row = db.find((item) => item.id === id);
      if (!row) {
        throw new Error(`unknown policy id ${id}`);
      }
      row.sortOrder = index + 1;
    }
    return respond("sla.list", undefined);
  }
  if (path === "sla.setActive") {
    const { id, active } = input as { id: string; active: boolean };
    const row = db.find((item) => item.id === id);
    if (!row) {
      throw new Error(`unknown policy id ${id}`);
    }
    row.active = active;
    return row;
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
    try {
      return { result: { data: respond(path, procedureInput) } };
    } catch (error) {
      const trpcCode = (error as { trpcCode?: unknown }).trpcCode;
      return {
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: -32600,
          data: {
            code: typeof trpcCode === "string" ? trpcCode : "BAD_REQUEST",
            httpStatus: trpcCode === "CONFLICT" ? 409 : 400,
            path,
          },
        },
      };
    }
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
function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected an item at index ${index}, got ${items.length}`);
  }
  return item;
}

function cardOrder(): string[] {
  return screen
    .getAllByRole("button", { name: /^编辑 / })
    .map((button) => button.getAttribute("aria-label")?.replace(/^编辑 /, "") ?? "");
}

async function openCreateDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "新增策略" }));
  return await screen.findByRole("dialog");
}

async function openEditDialog(name: string) {
  await screen.findByText(name);
  fireEvent.click(screen.getByRole("button", { name: `编辑 ${name}` }));
  return await screen.findByRole("dialog");
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.ADMIN);
  auth.isLoading = false;
  db = FACTORY.map((row) => ({ ...row }));
  createSeq = 0;
  calls = [];
});

describe("卡片墙", () => {
  it("按 sortOrder 渲染每张卡的名称、说明、首响、超时与提醒规则", async () => {
    renderSlaPage();

    await screen.findByText("一般投诉");
    expect(cardOrder()).toEqual(["一般投诉", "高级投诉", "加急投诉", "特急投诉", "VIP 专线"]);
    expect(screen.getAllByText("启用")).toHaveLength(4);
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByText("常规投诉：48 小时处理时限。")).toBeInTheDocument();
    expect(screen.getAllByText("120 分钟内首次跟进，过线染红")).toHaveLength(2);
    expect(screen.getAllByText(/48 小时（处理时限/)).toHaveLength(2);
    expect(screen.getByText("不设超时")).toBeInTheDocument();
    expect(screen.getByText(/每满 12 小时提醒/)).toBeInTheDocument();
    expect(screen.getAllByText(/24 小时内累计跟进 1 次，提前 60 分钟提醒/).length).toBeGreaterThan(
      0,
    );
  });

  it("停用卡灰显：已停用徽标 + 复活入口，且无停用按钮", async () => {
    renderSlaPage();

    await screen.findByText("VIP 专线");
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复活 VIP 专线" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停用 VIP 专线" })).not.toBeInTheDocument();
  });

  it("sla.view 无 sla.edit：只读卡片墙，无新增/编辑/排序/停用入口", async () => {
    auth.user = userWith({ name: "只读观察", permissions: ["sla.view"] });
    renderSlaPage();

    await screen.findByText("一般投诉");
    expect(screen.queryByRole("button", { name: "新增策略" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^编辑 / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^上移 / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^下移 / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^停用 / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^复活 / })).not.toBeInTheDocument();
  });
});

describe("新增策略", () => {
  it("保存成功：sla.create 携带解析后的载荷，新卡出现在列表末尾", async () => {
    renderSlaPage();
    const dialog = await openCreateDialog();

    fireEvent.change(within(dialog).getByLabelText("策略名称"), { target: { value: "夜间专线" } });
    fireEvent.change(within(dialog).getByLabelText("策略说明"), {
      target: { value: "夜间值班专用时效。" },
    });
    fireEvent.change(within(dialog).getByLabelText("首响违约线（分钟）"), {
      target: { value: "45" },
    });
    fireEvent.change(within(dialog).getByLabelText("超时时长（小时）"), {
      target: { value: "12" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加滚动提醒" }));
    fireEvent.change(within(dialog).getByLabelText("跟进间隔（小时）"), { target: { value: "6" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.create")?.input).toEqual({
        name: "夜间专线",
        description: "夜间值班专用时效。",
        firstResponseMinutes: 45,
        overdueHours: 12,
        reminderRules: [{ type: "rolling_follow_up", intervalHours: 6 }],
      }),
    );
    await waitFor(() =>
      expect(cardOrder()).toEqual([
        "一般投诉",
        "高级投诉",
        "加急投诉",
        "特急投诉",
        "VIP 专线",
        "夜间专线",
      ]),
    );
  });

  it("空名称、零首响、非数字超时各自给出字段错误并禁用保存", async () => {
    renderSlaPage();
    const dialog = await openCreateDialog();

    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("策略名称"), { target: { value: "  " } });
    expect(await within(dialog).findByText("策略名称不能为空")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("首响违约线（分钟）"), {
      target: { value: "0" },
    });
    expect(await within(dialog).findByText("需为正整数（分钟）")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("超时时长（小时）"), {
      target: { value: "abc" },
    });
    expect(await within(dialog).findByText("需为正整数（小时）")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
    expect(calls.some((call) => call.path === "sla.create")).toBe(false);
  });

  it("撞名（含停用行）：服务端 CONFLICT 落到名称字段错误", async () => {
    renderSlaPage();
    const dialog = await openCreateDialog();

    fireEvent.change(within(dialog).getByLabelText("策略名称"), { target: { value: "VIP 专线" } });
    fireEvent.change(within(dialog).getByLabelText("首响违约线（分钟）"), {
      target: { value: "30" },
    });
    fireEvent.click(within(dialog).getByLabelText("不设超时"));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText("时效策略「VIP 专线」名称已存在")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("编辑策略", () => {
  it("弹窗预填现值；保存按 id 分项提交改名与参数", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    expect(within(dialog).getByLabelText("策略名称")).toHaveValue("一般投诉");
    expect(within(dialog).getByLabelText("策略说明")).toHaveValue("常规投诉：48 小时处理时限。");
    expect(within(dialog).getByLabelText("首响违约线（分钟）")).toHaveValue("120");
    expect(within(dialog).getByLabelText("超时时长（小时）")).toHaveValue("48");

    fireEvent.change(within(dialog).getByLabelText("策略名称"), { target: { value: "常规投诉" } });
    fireEvent.change(within(dialog).getByLabelText("首响违约线（分钟）"), {
      target: { value: "90" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.update")?.input).toEqual({
        id: "p-normal",
        name: "常规投诉",
        description: "常规投诉：48 小时处理时限。",
        firstResponseMinutes: 90,
        overdueHours: 48,
        reminderRules: [
          {
            type: "follow_up_checkpoint",
            checkpointHours: 24,
            requiredCount: 1,
            advanceMinutes: 60,
          },
          {
            type: "follow_up_checkpoint",
            checkpointHours: 48,
            requiredCount: 2,
            advanceMinutes: 180,
          },
        ],
      }),
    );
    expect(await screen.findByText("常规投诉")).toBeInTheDocument();
  });

  it("改名为停用行撞名：字段级错误，弹窗保持打开", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    fireEvent.change(within(dialog).getByLabelText("策略名称"), { target: { value: "VIP 专线" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText("时效策略「VIP 专线」名称已存在")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("规则增删改与检查点校验沿用既有口径", async () => {
    renderSlaPage();
    const dialog = await openEditDialog("一般投诉");

    fireEvent.click(nth(within(dialog).getAllByRole("button", { name: "删除" }), 0));
    fireEvent.change(within(dialog).getByLabelText("检查点（小时）"), { target: { value: "1" } });
    expect(await within(dialog).findByText("提前提醒必须小于检查点时长")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("提前提醒（分钟）"), {
      target: { value: "30" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.update")?.input).toMatchObject({
        id: "p-normal",
        reminderRules: [
          {
            type: "follow_up_checkpoint",
            checkpointHours: 1,
            requiredCount: 2,
            advanceMinutes: 30,
          },
        ],
      }),
    );
  });
});

describe("排序", () => {
  it("下移首卡：sla.sort 收到交换后的全量清单，卡片墙即时重排", async () => {
    renderSlaPage();
    await screen.findByText("一般投诉");

    fireEvent.click(screen.getByRole("button", { name: "下移 一般投诉" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.sort")?.input).toEqual({
        policyIds: ["p-high", "p-normal", "p-urgent", "p-critical", "p-vip"],
      }),
    );
    await waitFor(() =>
      expect(cardOrder()).toEqual(["高级投诉", "一般投诉", "加急投诉", "特急投诉", "VIP 专线"]),
    );
  });

  it("上移末二卡：sla.sort 收到交换后的全量清单", async () => {
    renderSlaPage();
    await screen.findByText("特急投诉");

    fireEvent.click(screen.getByRole("button", { name: "上移 特急投诉" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.sort")?.input).toEqual({
        policyIds: ["p-normal", "p-high", "p-critical", "p-urgent", "p-vip"],
      }),
    );
  });

  it("首卡禁用上移，末卡禁用下移", async () => {
    renderSlaPage();
    await screen.findByText("一般投诉");

    expect(screen.getByRole("button", { name: "上移 一般投诉" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移 一般投诉" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上移 VIP 专线" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移 VIP 专线" })).toBeDisabled();
  });
});

describe("停用与复活", () => {
  it("停用需确认：确认后 setActive(false)，卡片灰显并出现复活入口", async () => {
    renderSlaPage();
    await screen.findByText("加急投诉");

    fireEvent.click(screen.getByRole("button", { name: "停用 加急投诉" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/加急投诉/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认停用" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.setActive")?.input).toEqual({
        id: "p-urgent",
        active: false,
      }),
    );
    expect(await screen.findByRole("button", { name: "复活 加急投诉" })).toBeInTheDocument();
    expect(screen.getAllByText("已停用")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "停用 加急投诉" })).not.toBeInTheDocument();
  });

  it("确认框可取消：不发请求", async () => {
    renderSlaPage();
    await screen.findByText("加急投诉");

    fireEvent.click(screen.getByRole("button", { name: "停用 加急投诉" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.some((call) => call.path === "sla.setActive")).toBe(false);
  });

  it("复活无需确认：直接 setActive(true)，卡片恢复正常", async () => {
    renderSlaPage();
    await screen.findByText("VIP 专线");

    fireEvent.click(screen.getByRole("button", { name: "复活 VIP 专线" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "sla.setActive")?.input).toEqual({
        id: "p-vip",
        active: true,
      }),
    );
    expect(await screen.findByRole("button", { name: "停用 VIP 专线" })).toBeInTheDocument();
    expect(screen.queryByText("已停用")).not.toBeInTheDocument();
  });
});
