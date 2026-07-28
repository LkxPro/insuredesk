import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { auth, callsTo, renderApp, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 机构详情页 /external-orgs/:id：头部信息 + 编辑/停用，可见字段整块展开，
 * 账号表承载机构账号全生命周期。路由与全部操作同由 external_org.manage
 * 把守——测试角色只持这一个点，不带任何 user.*。
 */

const ORG = {
  id: "o1",
  name: "机构甲",
  channelId: "ch1",
  channelName: "渠道一",
  visibleTicketFields: ["feedbackTime", "project"],
  userCount: 2,
  active: true,
};

const CHANNELS = [{ id: "ch1", name: "渠道一", active: true }];

const ORG_USERS = [
  {
    id: "eu1",
    username: "ext-zhang",
    name: "外部张三",
    email: "zhang@partner.example",
    active: true,
    roleId: "er1",
    roleName: "外部用户",
    createdAt: "2026-07-01T08:00:00.000Z",
  },
  {
    id: "eu2",
    username: "ext-li",
    name: "外部李四",
    email: null,
    active: false,
    roleId: "er2",
    roleName: "外部只读",
    createdAt: "2026-07-02T08:00:00.000Z",
  },
];

const EXTERNAL_ROLES = [
  { id: "er1", name: "外部用户" },
  { id: "er2", name: "外部只读" },
];

const ORG_LIST = [
  ORG,
  { ...ORG, id: "o2", name: "机构乙", userCount: 0 },
  { ...ORG, id: "o3", name: "停用机构丙", userCount: 0, active: false },
];

/** 只持 external_org.manage,一个 user.* 点都没有。 */
const ORG_MANAGER = {
  name: "机构管理员",
  permissions: ["external_org.manage"],
} as const;

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

/** Pick a Radix Select option: pointerDown opens, click commits. */
async function pick(scope: ReturnType<typeof within>, comboboxName: string, optionName: string) {
  const trigger = scope.getByRole("combobox", { name: comboboxName });
  // 选项查询未回来前 trigger 是 disabled 的，pointerDown 会被吞掉
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

/** Open a Radix Select and return its options' text, without committing. */
async function openedOptions(scope: ReturnType<typeof within>, comboboxName: string) {
  const trigger = scope.getByRole("combobox", { name: comboboxName });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
  fireEvent.click(trigger);
  const options = await screen.findAllByRole("option");
  return options.map((option) => option.textContent);
}

/** 页头与账号行共用按钮文案，按出现顺序取第 index 个。 */
async function nthButton(name: string, index: number) {
  const buttons = await screen.findAllByRole("button", { name });
  const button = buttons[index];
  if (!button) throw new Error(`按钮「${name}」#${index} 不存在`);
  return button;
}

function renderDetail(overrides: Record<string, unknown> = {}) {
  return renderApp({
    path: "/external-orgs/o1",
    role: ORG_MANAGER,
    trpc: {
      "externalOrg.get": ORG,
      "externalOrg.list": ORG_LIST,
      "externalOrg.listUsers": ORG_USERS,
      "externalOrg.externalRoleOptions": EXTERNAL_ROLES,
      "channel.list": CHANNELS,
      ...overrides,
    },
  });
}

describe("路由守卫", () => {
  it("requires external_org.manage", () => {
    auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
    renderApp({ path: "/external-orgs/o1" });
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
    expect(callsTo("externalOrg.get")).toHaveLength(0);
  });
});

describe("头部与机构信息", () => {
  it("shows name, status, channel, user count and the whitelist fields", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "机构甲" })).toBeInTheDocument();
    expect(screen.getAllByText("启用").length).toBeGreaterThan(0);
    expect(screen.getByText("渠道一")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("可见字段（2 个）")).toBeInTheDocument();
    expect(screen.getByText("反馈时间")).toBeInTheDocument();
    expect(screen.getByText("项目")).toBeInTheDocument();
  });

  it("null whitelist reads as 系统默认 with the default fields", async () => {
    renderDetail({ "externalOrg.get": { ...ORG, visibleTicketFields: null } });

    expect(await screen.findByText("可见字段（5 个，系统默认）")).toBeInTheDocument();
    expect(screen.getByText("工单号")).toBeInTheDocument();
    expect(screen.getByText("处理结果")).toBeInTheDocument();
  });

  it("a disabled org shows 已停用 and offers 启用", async () => {
    renderDetail({ "externalOrg.get": { ...ORG, active: false }, "externalOrg.listUsers": [] });
    expect(await screen.findByText("已停用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用" })).toBeInTheDocument();
  });
});

describe("停用与启用", () => {
  it("停用 calls setActive and refetches", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "停用" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.setActive")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.setActive")[0]?.input).toEqual({ id: "o1", active: false });
    expect(toastSpies.success).toHaveBeenCalledWith("已停用机构");
    await waitFor(() => {
      expect(callsTo("externalOrg.get").length).toBeGreaterThan(1);
    });
  });
});

describe("编辑弹窗回填", () => {
  it("opens pre-filled and a rename-only save keeps the whitelist", async () => {
    renderDetail();
    // 首个「编辑」属于机构头部，其余是账号行
    fireEvent.click(await nthButton("编辑", 0));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("机构名称")).toHaveValue("机构甲");
    expect(dialog.getByRole("checkbox", { name: "反馈时间" })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "项目" })).toBeChecked();

    fireEvent.change(dialog.getByLabelText("机构名称"), { target: { value: "机构甲改名" } });
    fireEvent.click(dialog.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.update")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.update")[0]?.input).toMatchObject({
      id: "o1",
      name: "机构甲改名",
      visibleTicketFields: ["feedbackTime", "project"],
    });
    // 保存后详情重取，展示新数据
    await waitFor(() => {
      expect(callsTo("externalOrg.get").length).toBeGreaterThan(1);
    });
  });
});

describe("账号表", () => {
  it("lists accounts with role and state, no team column", async () => {
    renderDetail();

    expect(await screen.findByText("外部张三")).toBeInTheDocument();
    expect(screen.getByText("ext-zhang")).toBeInTheDocument();
    expect(screen.getByText("zhang@partner.example")).toBeInTheDocument();
    expect(screen.getByText("外部用户")).toBeInTheDocument();
    expect(screen.getByText("外部李四")).toBeInTheDocument();
    expect(screen.getByText("已禁用")).toBeInTheDocument();
    expect(screen.queryByText("团队")).not.toBeInTheDocument();
    expect(callsTo("externalOrg.listUsers")[0]?.input).toEqual({ orgId: "o1" });
  });

  it("empty org reads 暂无账号", async () => {
    renderDetail({ "externalOrg.listUsers": [] });
    expect(await screen.findByText("暂无账号")).toBeInTheDocument();
  });
});

describe("新建账号", () => {
  it("机构锁定当前机构、角色下拉仅外部角色，提交不含团队", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "新建账号" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("所属机构")).toHaveValue("机构甲");
    expect(dialog.getByLabelText("所属机构")).toBeDisabled();
    expect(dialog.queryByLabelText(/团队/)).not.toBeInTheDocument();

    fireEvent.change(dialog.getByLabelText("姓名"), { target: { value: "新外部成员" } });
    fireEvent.change(dialog.getByLabelText("用户名"), { target: { value: "ext-new" } });
    fireEvent.change(dialog.getByLabelText("初始密码"), { target: { value: "secret-123" } });

    expect(await openedOptions(dialog, "角色")).toEqual(["外部用户", "外部只读"]);
    fireEvent.click(screen.getByRole("option", { name: "外部只读" }));

    fireEvent.click(dialog.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.createUser")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.createUser")[0]?.input).toEqual({
      orgId: "o1",
      username: "ext-new",
      password: "secret-123",
      name: "新外部成员",
      email: null,
      roleId: "er2",
    });
  });
});

describe("编辑账号", () => {
  it("回填基础信息，可迁移到其他启用机构；停用机构不进下拉", async () => {
    renderDetail();
    fireEvent.click(await nthButton("编辑", 1));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("姓名")).toHaveValue("外部张三");
    expect(dialog.getByLabelText("用户名")).toHaveValue("ext-zhang");

    expect(await openedOptions(dialog, "所属外部机构")).toEqual(["机构甲", "机构乙"]);
    fireEvent.click(screen.getByRole("option", { name: "机构乙" }));

    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.updateUser")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.updateUser")[0]?.input).toEqual({
      id: "eu1",
      username: "ext-zhang",
      name: "外部张三",
      email: "zhang@partner.example",
      password: null,
      externalOrgId: "o2",
    });
  });

  it("重置密码随表单一起提交", async () => {
    renderDetail();
    fireEvent.click(await nthButton("编辑", 1));

    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("重置密码"), { target: { value: "rotated-1" } });
    fireEvent.click(dialog.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.updateUser")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.updateUser")[0]?.input).toMatchObject({
      id: "eu1",
      password: "rotated-1",
    });
  });
});

describe("换角色", () => {
  it("下拉仅外部角色，确认后 assignUserRole", async () => {
    renderDetail();
    fireEvent.click(await nthButton("换角色", 0));

    const dialog = within(await screen.findByRole("dialog"));
    // 未改角色时确认不可用
    expect(dialog.getByRole("button", { name: "确认" })).toBeDisabled();

    await pick(dialog, "角色", "外部只读");
    fireEvent.click(dialog.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.assignUserRole")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.assignUserRole")[0]?.input).toEqual({ id: "eu1", roleId: "er2" });
  });
});

describe("禁用与启用账号", () => {
  it("禁用先确认，提交 setUserActive false", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "禁用" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/外部张三/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "确认禁用" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.setUserActive")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.setUserActive")[0]?.input).toEqual({ id: "eu1", active: false });
  });

  it("启用直接生效并刷新列表", async () => {
    renderDetail({
      "externalOrg.setUserActive": { id: "eu2", name: "外部李四", active: true },
    });
    // 表内的启用按钮属于已禁用的外部李四；头部机构按钮此时显示「停用」
    fireEvent.click(await screen.findByRole("button", { name: "启用" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.setUserActive")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.setUserActive")[0]?.input).toEqual({ id: "eu2", active: true });
    expect(toastSpies.success).toHaveBeenCalledWith("已启用账号 外部李四");
    await waitFor(() => {
      expect(callsTo("externalOrg.listUsers").length).toBeGreaterThan(1);
    });
  });
});
