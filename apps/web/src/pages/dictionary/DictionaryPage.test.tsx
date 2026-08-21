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
  userFeedbackChannels: [
    {
      id: "ufc-hotline",
      name: "保司400热线",
      active: true,
      displayOrder: 1,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
  ],
  feedbackReceiveChannels: [
    {
      id: "frc-wechat",
      name: "（微信）凯森&骏伯反馈对接群",
      active: true,
      displayOrder: 1,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
  ],
};
let calls: Array<{ path: string; input: unknown }>;
let deleteError: string | null;

const lists: Record<string, unknown> = {
  "channel.list": canned.channels,
  "ticketCategory.list": canned.categories,
  "completionStatus.list": canned.completionStatuses,
  "userFeedbackChannel.list": canned.userFeedbackChannels,
  "feedbackReceiveChannel.list": canned.feedbackReceiveChannels,
};

function respond(path: string, input: unknown): unknown {
  if (path === "notification.list") {
    return { items: [], unreadCount: 0, todo: { items: [], count: 0 } };
  }
  if (path in lists) return lists[path];
  const [, procedure] = path.split(".");
  if (procedure === "create") {
    return { id: "new", active: true, displayOrder: 99, ...(input as object) };
  }
  if (procedure === "update") {
    return { active: true, ...(input as object) };
  }
  if (procedure === "setActive") {
    return { name: "目录项", displayOrder: 1, ...(input as object) };
  }
  if (procedure === "reorder") {
    return input;
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

async function openSheet(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: `管理${title}` }));
  await screen.findAllByRole("dialog");
  const sheet = screen
    .getAllByRole("dialog")
    .find((dialog) => within(dialog).queryByText(title) !== null);
  if (!sheet) throw new Error(`未找到「${title}」的管理抽屉`);
  return sheet;
}

/**
 * 内层 CatalogDialog（增改/删除确认）。Sheet 也是 dialog role，且内层弹窗打开时
 * Radix 会把 Sheet aria-hidden 掉 — byRole 查询同时只能看到一个，所以内层弹窗
 * 直接用 data-slot 定位。
 */
async function topDialog() {
  await waitFor(() =>
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull(),
  );
  const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  if (!dialog) throw new Error("未找到弹窗");
  return dialog;
}

async function waitDialogClosed() {
  await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull());
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.ADMIN);
  auth.isLoading = false;
  calls = [];
  deleteError = null;
});

describe("字典管理 page", () => {
  it("requires dictionary.manage: holders see the catalog cards, others land on 403", async () => {
    renderPage();
    expect(await screen.findByText(/保司/)).toBeInTheDocument();
    expect(screen.getByText(/理赔投诉/)).toBeInTheDocument();
    expect(screen.getByText(/正常完结/)).toBeInTheDocument();

    const sheet = await openSheet("客诉类别");
    expect(await within(sheet).findByText("理赔投诉")).toBeInTheDocument();
    expect(within(sheet).getByText("启用")).toBeInTheDocument();
    expect(within(sheet).getByText("已停用")).toBeInTheDocument();

    auth.user = userWith(TEST_ROLES.CS_MANAGER);
    renderPage();
    expect(await screen.findByText("你没有访问该页面的权限")).toBeInTheDocument();
  });
});

describe("CatalogAdmin behavior (via 客诉类别)", () => {
  it("creates an entry with just a name — 顺序由拖拽编排", async () => {
    renderPage();
    const sheet = await openSheet("客诉类别");
    fireEvent.click(within(sheet).getByRole("button", { name: "新增类别" }));
    const dialog = await topDialog();

    fireEvent.change(within(dialog).getByLabelText("类别名称"), {
      target: { value: "新增测试类别" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.create")?.input).toEqual({
        name: "新增测试类别",
      }),
    );
  });

  it("maps schema validation errors onto the name field without calling the server", async () => {
    renderPage();
    const sheet = await openSheet("客诉类别");
    fireEvent.click(within(sheet).getByRole("button", { name: "新增类别" }));
    const dialog = await topDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(dialog).findByText("请填写类别名称")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "ticketCategory.create")).toBe(false);
  });

  it("renames, toggles 停用/启用, and deletes through explicit controls", async () => {
    renderPage();
    const sheet = await openSheet("客诉类别");
    await within(sheet).findByText("理赔投诉");

    fireEvent.click(within(sheet).getByRole("button", { name: "编辑 理赔投诉" }));
    const editDialog = await topDialog();
    fireEvent.change(within(editDialog).getByLabelText("类别名称"), {
      target: { value: "理赔类投诉" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.update")?.input).toEqual({
        id: "cat-claims",
        name: "理赔类投诉",
      }),
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "停用 理赔投诉" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.setActive")?.input).toEqual({
        id: "cat-claims",
        active: false,
      }),
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "启用 回访问题" }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path === "ticketCategory.setActive").at(-1)?.input,
      ).toEqual({ id: "cat-visit", active: true }),
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "删除 回访问题" }));
    const deleteDialog = await topDialog();
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.delete")?.input).toEqual({
        id: "cat-visit",
      }),
    );
  });

  it("reorders by drag and by keyboard, posting the full ordered id list", async () => {
    renderPage();
    const sheet = await openSheet("客诉类别");
    await within(sheet).findByText("理赔投诉");

    fireEvent.keyDown(within(sheet).getByRole("button", { name: /排序 理赔投诉/ }), {
      key: "ArrowDown",
    });
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.reorder")?.input).toEqual({
        ids: ["cat-visit", "cat-claims"],
      }),
    );

    const sourceRow = within(sheet).getByText("理赔投诉").closest("tr");
    const targetRow = within(sheet).getByText("回访问题").closest("tr");
    if (!sourceRow || !targetRow) throw new Error("未找到表格行");
    fireEvent.dragStart(sourceRow, { dataTransfer: { effectAllowed: "" } });
    fireEvent.dragOver(targetRow, { dataTransfer: { effectAllowed: "" } });
    fireEvent.drop(targetRow, { dataTransfer: { effectAllowed: "" } });

    await waitFor(() =>
      expect(calls.filter((call) => call.path === "ticketCategory.reorder").at(-1)?.input).toEqual({
        ids: ["cat-visit", "cat-claims"],
      }),
    );
  });

  function gripOrder(sheet: HTMLElement) {
    return within(sheet)
      .getAllByRole("button", { name: /^排序 / })
      .map((grip) => grip.getAttribute("aria-label"));
  }

  it("按名称预览排序：预览不写库，保存才提交 reorder", async () => {
    renderPage();
    const sheet = await openSheet("客诉类别");
    await within(sheet).findByText("理赔投诉");
    expect(gripOrder(sheet)).toEqual([
      "排序 理赔投诉，方向键上下移动",
      "排序 回访问题，方向键上下移动",
    ]);

    fireEvent.click(within(sheet).getByRole("combobox", { name: "排序方式" }));
    fireEvent.click(await screen.findByRole("option", { name: "名称 A→Z（拼音）" }));

    expect(await within(sheet).findByText("按名称升序预览中")).toBeInTheDocument();
    expect(gripOrder(sheet)).toEqual([
      "排序 回访问题，方向键上下移动",
      "排序 理赔投诉，方向键上下移动",
    ]);
    for (const grip of within(sheet).getAllByRole("button", { name: /^排序 / })) {
      expect(grip).toBeDisabled();
    }
    expect(calls.some((call) => call.path === "ticketCategory.reorder")).toBe(false);

    fireEvent.click(within(sheet).getByRole("button", { name: "保存此顺序" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "ticketCategory.reorder")?.input).toEqual({
        ids: ["cat-visit", "cat-claims"],
      }),
    );
    await waitFor(() => expect(within(sheet).queryByText(/预览中/)).toBeNull());
    for (const grip of within(sheet).getAllByRole("button", { name: /^排序 / })) {
      expect(grip).toBeEnabled();
    }
  });

  it("名称预览可取消：回到手动顺序且不写库", async () => {
    renderPage();
    const sheet = await openSheet("客诉类别");
    await within(sheet).findByText("理赔投诉");

    fireEvent.click(within(sheet).getByRole("combobox", { name: "排序方式" }));
    fireEvent.click(await screen.findByRole("option", { name: "名称 A→Z（拼音）" }));
    expect(await within(sheet).findByText("按名称升序预览中")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(within(sheet).queryByText(/预览中/)).toBeNull());
    expect(gripOrder(sheet)).toEqual([
      "排序 理赔投诉，方向键上下移动",
      "排序 回访问题，方向键上下移动",
    ]);
    expect(calls.some((call) => call.path === "ticketCategory.reorder")).toBe(false);
  });

  it("surfaces the server's reference-count refusal on delete", async () => {
    deleteError = "该类别已被 3 张工单使用，无法删除，可改为停用";
    renderPage();
    const sheet = await openSheet("客诉类别");
    await within(sheet).findByText("理赔投诉");

    fireEvent.click(within(sheet).getByRole("button", { name: "删除 理赔投诉" }));
    const deleteDialog = await topDialog();
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
    {
      catalog: "用户反馈渠道",
      ns: "userFeedbackChannel",
      addLabel: "新增用户反馈渠道",
      nameLabel: "渠道名称",
      row: { id: "ufc-hotline", name: "保司400热线" },
      refusal: "该用户反馈渠道已被 2 张工单使用，无法删除，可改为停用",
    },
    {
      catalog: "反馈信息接收渠道",
      ns: "feedbackReceiveChannel",
      addLabel: "新增反馈信息接收渠道",
      nameLabel: "渠道名称",
      row: { id: "frc-wechat", name: "（微信）凯森&骏伯反馈对接群" },
      refusal: "该反馈信息接收渠道已被 2 张工单使用，无法删除，可改为停用",
    },
  ])("$catalog wires every procedure to its own namespace", async (c) => {
    renderPage();
    const sheet = await openSheet(c.catalog);
    await within(sheet).findByText(c.row.name);

    fireEvent.click(within(sheet).getByRole("button", { name: c.addLabel }));
    const createDialog = await topDialog();
    fireEvent.change(within(createDialog).getByLabelText(c.nameLabel), {
      target: { value: "冒烟新增项" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.create`)?.input).toEqual({
        name: "冒烟新增项",
      }),
    );
    await waitDialogClosed();

    fireEvent.click(within(sheet).getByRole("button", { name: `编辑 ${c.row.name}` }));
    const editDialog = await topDialog();
    fireEvent.change(within(editDialog).getByLabelText(c.nameLabel), {
      target: { value: "冒烟改名项" },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.update`)?.input).toEqual({
        id: c.row.id,
        name: "冒烟改名项",
      }),
    );
    await waitDialogClosed();

    fireEvent.click(within(sheet).getByRole("button", { name: `停用 ${c.row.name}` }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.setActive`)?.input).toEqual({
        id: c.row.id,
        active: false,
      }),
    );

    deleteError = c.refusal;
    fireEvent.click(within(sheet).getByRole("button", { name: `删除 ${c.row.name}` }));
    const deleteDialog = await topDialog();
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    expect(await within(deleteDialog).findByText(c.refusal)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((call) => call.path === `${c.ns}.delete`)?.input).toEqual({
        id: c.row.id,
      }),
    );
  });
});
