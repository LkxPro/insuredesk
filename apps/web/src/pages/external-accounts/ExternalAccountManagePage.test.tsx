import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

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

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    username: "partner1",
    name: "甲合作方",
    email: "partner1@example.com",
    active: true,
    createdAt: "2026-07-20T02:00:00.000Z",
    prefill: {
      channelId: "ch-baosi",
      channelName: "保司",
      project: "融盛",
      brokerageEntity: null,
      paymentChannel: null,
      userComplaintChannelId: null,
      userComplaintChannelName: null,
      complaintReceiveChannelId: null,
      complaintReceiveChannelName: null,
    },
    ticketCount: 3,
    ...overrides,
  };
}

const CHANNEL_OPTIONS = [
  { id: "ch-baosi", name: "保司" },
  { id: "ch-jianguan", name: "监管" },
];

function renderPage(overrides: Record<string, unknown> = {}) {
  return renderApp({
    path: "/external-accounts",
    role: TEST_ROLES.ADMIN,
    trpc: {
      "externalAccount.list": [accountRow()],
      "channel.options": CHANNEL_OPTIONS,
      "userComplaintChannel.options": [],
      "complaintReceiveChannel.options": [],
      "externalAccount.create": { id: "acc-new", name: "新账号" },
      "externalAccount.update": { id: "acc-1", name: "甲合作方" },
      "externalAccount.setActive": { id: "acc-1", name: "甲合作方", active: false },
      ...overrides,
    },
  });
}

describe("账号列表", () => {
  it("renders name, prefill summary, ticket count and status", async () => {
    renderPage();

    const row = (await screen.findByText("甲合作方")).closest("tr") as HTMLElement;
    expect(within(row).getByText("partner1")).toBeInTheDocument();
    expect(within(row).getByText("保司 · 融盛")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("启用")).toBeInTheDocument();
  });

  it("shows — for an account without prefill", async () => {
    renderPage({
      "externalAccount.list": [
        accountRow({
          prefill: {
            channelId: null,
            channelName: null,
            project: null,
            brokerageEntity: null,
            paymentChannel: null,
            userComplaintChannelId: null,
            userComplaintChannelName: null,
            complaintReceiveChannelId: null,
            complaintReceiveChannelName: null,
          },
        }),
      ],
    });

    const row = (await screen.findByText("甲合作方")).closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});

describe("新建账号", () => {
  it("submits basic info plus prefill through externalAccount.create", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新建账号" }));

    await screen.findByRole("heading", { name: "新建外部账号" });
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "乙合作方" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "partner2" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "secret-123" } });

    const trigger = screen.getByRole("combobox", { name: "反馈渠道" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "监管" }));

    fireEvent.change(screen.getByRole("textbox", { name: "项目（保司）" }), {
      target: { value: "泰康" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(callsTo("externalAccount.create")[0]?.input).toMatchObject({
        username: "partner2",
        password: "secret-123",
        name: "乙合作方",
        prefill: { channelId: "ch-jianguan", project: "泰康" },
      }),
    );
    expect(toastSpies.success).toHaveBeenCalledWith("已创建账号 新账号");
  });

  it("初始密码留空被拦下,不发请求", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "新建账号" }));
    await screen.findByRole("heading", { name: "新建外部账号" });

    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "乙合作方" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "partner2" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("密码至少 6 位")).toBeInTheDocument();
    expect(callsTo("externalAccount.create")).toHaveLength(0);
  });
});

describe("编辑账号", () => {
  it("pre-populates prefill, submits the replacement block", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    await screen.findByRole("heading", { name: "编辑外部账号" });
    expect(screen.getByRole("textbox", { name: "姓名" })).toHaveValue("甲合作方");
    expect(screen.getByRole("textbox", { name: "项目（保司）" })).toHaveValue("融盛");

    fireEvent.change(screen.getByRole("textbox", { name: "经纪主体" }), {
      target: { value: "凯森" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(callsTo("externalAccount.update")[0]?.input).toMatchObject({
        id: "acc-1",
        prefill: { channelId: "ch-baosi", project: "融盛", brokerageEntity: "凯森" },
      }),
    );
  });
});

describe("启停", () => {
  it("禁用走确认弹窗", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "禁用" }));

    await screen.findByRole("heading", { name: "禁用账号" });
    fireEvent.click(screen.getByRole("button", { name: "确认禁用" }));

    await waitFor(() =>
      expect(callsTo("externalAccount.setActive")[0]?.input).toEqual({
        id: "acc-1",
        active: false,
      }),
    );
    expect(toastSpies.success).toHaveBeenCalledWith("已禁用账号 甲合作方");
  });

  it("启用直接从表格发起,无确认", async () => {
    renderPage({
      "externalAccount.list": [accountRow({ active: false })],
      "externalAccount.setActive": { id: "acc-1", name: "甲合作方", active: true },
    });
    fireEvent.click(await screen.findByRole("button", { name: "启用" }));

    await waitFor(() =>
      expect(callsTo("externalAccount.setActive")[0]?.input).toEqual({
        id: "acc-1",
        active: true,
      }),
    );
  });
});
