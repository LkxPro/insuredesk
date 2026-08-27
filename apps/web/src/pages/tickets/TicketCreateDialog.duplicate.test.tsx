import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTime } from "@/lib/datetime";
// renderApp 模块在求值时注册 auth/toast 的 vi.mock，必须先于依赖它们的模块导入
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

const NOW = new Date("2026-08-14T09:30:00.000Z");

function dupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dup-1",
    workOrderNumber: "WO100090",
    customerName: "王秀英",
    createdAt: "2026-08-12T06:32:00.000Z",
    displayStatus: "processing",
    matchedFields: ["phone"],
    activityAt: "2026-08-12T09:05:00.000Z",
    activityText: "客户补充提交了缴费凭证，待核身",
    ...overrides,
  };
}

function dupResolver(input: unknown) {
  const query = input as {
    policyNumbers?: string[];
    phone?: string | null;
    contactPhone?: string | null;
  };
  const matchedFields = [
    query.policyNumbers?.length ? "policyNumbers" : null,
    query.phone ? "phone" : null,
    query.contactPhone ? "contactPhone" : null,
  ].filter((field): field is string => field !== null);
  return matchedFields.length > 0 ? [dupRow({ matchedFields })] : [];
}

function conflictError() {
  return Object.assign(new Error("发现 1 个可能重复的工单"), { trpcCode: "CONFLICT" });
}

function detailPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-10T02:00:00.000Z",
    updatedAt: "2026-07-10T02:00:00.000Z",
    feedbackTime: null,
    source: "manual",
    createdBy: "测试用户",
    channel: null,
    project: null,
    brokerageEntity: null,
    paymentChannel: null,
    internalOrderNumber: null,
    policyNumbers: [],
    userFeedbackChannel: null,
    feedbackReceiveChannel: null,
    customerName: "张小可",
    phone: "13800000000",
    contactPhone: null,
    customerRequest: null,
    submissionText: null,
    nuclearBodyStatus: null,
    hasContacted: null,
    contactTime: null,
    contactId: null,
    category: null,
    complaintLevel: null,
    priority: null,
    followUpFrequency: null,
    firstResponseRequirement: null,
    status: "unassigned",
    displayStatus: "unassigned",
    assigneeId: null,
    assigneeName: null,
    assignedAt: null,
    dueAt: null,
    nextContactTime: null,
    contactCount: 0,
    completionTime: null,
    completionStatus: null,
    processLogs: [],
    ...overrides,
  };
}

function renderCreate(trpc: Record<string, unknown> = {}) {
  return renderApp({
    path: "/tickets/new",
    trpc: {
      "ticket.findDuplicates": dupResolver,
      "channel.options": [],
      "ticketCategory.options": [],
      ...trpc,
    },
  });
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("建单即时查重提示", () => {
  it("客户电话满 11 位触发查重，提示挂在该字段下、始终展开、行新标签打开", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.change(screen.getByLabelText("客户电话（投保人）"), {
      target: { value: "13800001111" },
    });

    expect(await screen.findByText("1 个工单使用相同客户电话，确认后再提交")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "WO100090" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "/tickets/dup-1");
    const row = link.closest("li") as HTMLElement;
    expect(row).toHaveTextContent(formatDateTime(dupRow().activityAt));
    expect(row).not.toHaveTextContent(formatDateTime(dupRow().createdAt));
    expect(screen.queryByText(/个工单使用相同保单号/)).not.toBeInTheDocument();
  });

  it("保单号按非字母数字分隔符拆分后参与查重", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.change(screen.getByRole("textbox", { name: "保单号" }), {
      target: { value: "PA1，PA2" },
    });

    expect(await screen.findByText(/个工单使用相同保单号/)).toBeInTheDocument();
    const query = callsTo("ticket.findDuplicates").at(-1);
    expect(query?.input).toMatchObject({ policyNumbers: ["PA1", "PA2"] });
  });

  it("手机号不足 11 位且未失焦不查，失焦即查", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    const phoneInput = screen.getByLabelText("客户电话（投保人）");
    fireEvent.change(phoneInput, { target: { value: "138" } });
    vi.advanceTimersByTime(1000);
    expect(callsTo("ticket.findDuplicates")).toEqual([]);

    fireEvent.blur(phoneInput);
    expect(await screen.findByText(/个工单使用相同客户电话/)).toBeInTheDocument();
    expect(callsTo("ticket.findDuplicates").at(-1)?.input).toMatchObject({ phone: "138" });
  });
});

describe("建单提交 409 兜底", () => {
  function renderCreateConflict() {
    renderCreate({
      "ticket.create": (input: unknown) => {
        if ((input as { allowDuplicate?: boolean }).allowDuplicate) {
          return { id: "t9", workOrderNumber: "WO100099" };
        }
        throw conflictError();
      },
    });
  }

  it("确认框列出重复工单，仍要创建带 allowDuplicate 重发", async () => {
    renderCreateConflict();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.change(screen.getByLabelText("客户电话（投保人）"), {
      target: { value: "13800001111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    const confirmButton = await screen.findByRole("button", { name: "仍要创建" });
    const confirmDialog = confirmButton.closest('[role="dialog"]') as HTMLElement;
    expect(await within(confirmDialog).findByRole("link", { name: "WO100090" })).toHaveAttribute(
      "target",
      "_blank",
    );

    fireEvent.click(confirmButton);
    await waitFor(() => expect(callsTo("ticket.create")).toHaveLength(2));
    expect(callsTo("ticket.create")[1]?.input).toMatchObject({
      phone: "13800001111",
      allowDuplicate: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "新建工单" })).not.toBeInTheDocument(),
    );
  });

  it("取消确认框则不再提交，回到表单继续编辑", async () => {
    renderCreateConflict();
    await screen.findByRole("heading", { name: "新建工单" });
    fireEvent.change(screen.getByLabelText("客户电话（投保人）"), {
      target: { value: "13800001111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    const confirmButton = await screen.findByRole("button", { name: "仍要创建" });
    const confirmDialog = confirmButton.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "仍要创建" })).not.toBeInTheDocument(),
    );
    expect(callsTo("ticket.create")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "新建工单" })).toBeInTheDocument();
  });
});

describe("编辑查重", () => {
  function renderDetailEdit() {
    renderApp({
      path: "/tickets/t1",
      trpc: {
        "ticket.detail": detailPayload(),
        "ticket.findDuplicates": dupResolver,
        "ticket.editComplaint": (input: unknown) => {
          if ((input as { allowDuplicate?: boolean }).allowDuplicate) {
            return { id: "t1", workOrderNumber: "WO100001", changedFields: ["phone"] };
          }
          throw conflictError();
        },
        "channel.options": [],
        "ticketCategory.options": [],
      },
    });
  }

  it("编辑态即时查重排除自身；保存 409 后仍要保存带 allowDuplicate + ticketId", async () => {
    renderDetailEdit();
    const pane = await screen.findByRole("region", { name: "工单详情" });
    await waitFor(() => expect(pane).toHaveTextContent("WO100001"));

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByRole("button", { name: "保存修改" });

    await waitFor(() => expect(callsTo("ticket.findDuplicates").length).toBeGreaterThan(0));
    expect(callsTo("ticket.findDuplicates")[0]?.input).toMatchObject({
      phone: "13800000000",
      excludeTicketId: "t1",
    });
    expect(await within(pane).findByText(/个工单使用相同客户电话/)).toBeInTheDocument();

    fireEvent.change(within(pane).getByLabelText("客户电话（投保人）"), {
      target: { value: "13900009999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    fireEvent.click(await screen.findByRole("button", { name: "仍要保存" }));
    await waitFor(() => expect(callsTo("ticket.editComplaint")).toHaveLength(2));
    expect(callsTo("ticket.editComplaint")[1]?.input).toMatchObject({
      ticketId: "t1",
      phone: "13900009999",
      allowDuplicate: true,
    });
  });
});

describe("详情页重复工单条幅", () => {
  const bannerDups = [
    dupRow({
      id: "d1",
      workOrderNumber: "WO100091",
      displayStatus: "completed",
      activityAt: "2026-08-10T06:00:00.000Z",
      activityText: "已按原路退回保费，客户确认到账",
    }),
    dupRow({
      id: "d2",
      workOrderNumber: "WO100092",
      displayStatus: "processing",
      activityAt: "2026-08-12T01:05:00.000Z",
      activityText: "客户补充提交了缴费凭证，待核身",
    }),
  ];

  function renderDetail(dups: unknown) {
    renderApp({
      path: "/tickets/t1",
      trpc: {
        "ticket.detail": detailPayload(),
        "ticket.findDuplicates": dups,
        "channel.options": [],
        "ticketCategory.options": [],
      },
    });
  }

  it("收起只显最近 1 条，+N 原地展开全部；条目两行、裸文本无前缀", async () => {
    renderDetail(bannerDups);
    const pane = await screen.findByRole("region", { name: "工单详情" });
    await waitFor(() => expect(pane).toHaveTextContent("WO100001"));

    expect(await within(pane).findByText("该客户另有 2 个工单")).toBeInTheDocument();
    expect(within(pane).getByRole("link", { name: "WO100091" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(within(pane).queryByRole("link", { name: "WO100092" })).not.toBeInTheDocument();
    expect(within(pane).getByText("已按原路退回保费，客户确认到账")).toBeInTheDocument();
    expect(within(pane).queryByText(/完结状态：/)).not.toBeInTheDocument();
    expect(within(pane).queryByText(/最新记录/)).not.toBeInTheDocument();

    fireEvent.click(within(pane).getByRole("button", { name: "展开其余 1 个工单" }));
    expect(within(pane).getByRole("link", { name: "WO100092" })).toBeInTheDocument();
    expect(within(pane).getByText("客户补充提交了缴费凭证，待核身")).toBeInTheDocument();

    fireEvent.click(within(pane).getByRole("button", { name: "收起" }));
    expect(within(pane).queryByRole("link", { name: "WO100092" })).not.toBeInTheDocument();
  });

  it("无重复工单不渲染条幅", async () => {
    renderDetail([]);
    const pane = await screen.findByRole("region", { name: "工单详情" });
    await waitFor(() => expect(pane).toHaveTextContent("WO100001"));
    await waitFor(() => expect(callsTo("ticket.findDuplicates").length).toBeGreaterThan(0));
    expect(within(pane).queryByText(/该客户另有/)).not.toBeInTheDocument();
  });
});
