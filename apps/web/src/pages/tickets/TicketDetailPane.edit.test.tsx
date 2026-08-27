import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { categoryOptions, channelOptions, detailPayload, listItem } from "./detail-pane-fixtures";

// Radix Select 用 jsdom 未实现的 pointer-capture / scroll API 驱动下拉
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});

const rows = [
  listItem({ id: "t1", workOrderNumber: "WO100001" }),
  listItem({ id: "t2", workOrderNumber: "WO100002", customerName: "李大华" }),
];

const details: Record<string, Record<string, unknown>> = {
  t1: detailPayload({ id: "t1", workOrderNumber: "WO100001" }),
  t2: detailPayload({ id: "t2", workOrderNumber: "WO100002", customerName: "李大华" }),
};

function renderAt(path = "/tickets/t1", editResult: unknown = undefined) {
  return renderApp({
    path,
    trpc: {
      "ticket.list": { items: rows, total: rows.length, page: 1, pageSize: 20 },
      "ticket.detail": (input: unknown) => details[(input as { id: string }).id],
      "ticket.editComplaint":
        editResult ?? (() => ({ id: "t1", workOrderNumber: "WO100001", status: "processing" })),
      "channel.options": channelOptions,
      "ticketCategory.options": categoryOptions,
    },
  });
}

async function findPane(workOrderNumber = "WO100001") {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent(workOrderNumber));
  return pane;
}

async function enterEditing() {
  renderAt();
  const pane = await findPane();
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument());
  return pane;
}

function editInputs() {
  return callsTo("ticket.editComplaint").map((call) => call.input as Record<string, unknown>);
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

describe("编辑态的进入与退出", () => {
  it("点编辑：字段原位变控件，头部换成取消/保存", async () => {
    const pane = await enterEditing();

    const nameInput = within(pane).getByLabelText("客户姓名");
    expect(nameInput).toHaveValue("王小明");
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完结工单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "改派" })).not.toBeInTheDocument();
  });

  it("SLA 派生字段在编辑态仍只读 —— 由服务端按等级重算", async () => {
    const pane = await enterEditing();

    expect(within(pane).getByText("24小时内累计跟进1次")).toBeInTheDocument();
    expect(within(pane).queryByLabelText("跟进频次")).not.toBeInTheDocument();
    expect(within(pane).queryByLabelText("首次响应要求")).not.toBeInTheDocument();
  });

  it("干净草稿点取消直接回只读，不弹确认", async () => {
    await enterEditing();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("保存", () => {
  it("一次保存 = 一次 ticket.editComplaint，带整单字段与工单 id", async () => {
    const pane = await enterEditing();

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.change(within(pane).getByLabelText("客户诉求"), {
      target: { value: "要求加急处理" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(editInputs()).toHaveLength(1));
    const input = editInputs()[0] as Record<string, unknown>;
    expect(input.ticketId).toBe("t1");
    expect(input.customerName).toBe("王大明");
    expect(input.customerRequest).toBe("要求加急处理");
    // 整单提交：未改的字段也一起送，服务端据此算 diff
    expect(input.phone).toBe("13800000001");
  });

  it("保存成功回只读并回读详情 —— 派生字段与时间线都由服务端给", async () => {
    const pane = await enterEditing();

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    const detailCallsBefore = callsTo("ticket.detail").length;
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument());
    expect(toastSpies.success).toHaveBeenCalledWith("工单 WO100001 已更新");
    await waitFor(() => expect(callsTo("ticket.detail").length).toBeGreaterThan(detailCallsBefore));
  });

  it("空 diff 不发请求，提示未修改", async () => {
    await enterEditing();

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(toastSpies.warning).toHaveBeenCalledWith("未修改任何字段"));
    expect(editInputs()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("保存失败留在编辑态并显示服务端消息，草稿不丢", async () => {
    renderApp({
      path: "/tickets/t1",
      trpc: {
        "ticket.list": { items: rows, total: rows.length, page: 1, pageSize: 20 },
        "ticket.detail": details.t1,
        "channel.options": channelOptions,
        "ticketCategory.options": categoryOptions,
        "ticket.editComplaint": () => {
          throw new Error("工单已被他人修改，请刷新后重试");
        },
      },
    });
    const pane = await findPane();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument(),
    );

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("保存失败")).toBeInTheDocument());
    expect(screen.getByText("工单已被他人修改，请刷新后重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(within(pane).getByLabelText("客户姓名")).toHaveValue("王大明");
  });
});

it("字段里按 ↑/↓ 只移动光标，不翻单", async () => {
  const pane = await enterEditing();

  fireEvent.keyDown(within(pane).getByLabelText("客户姓名"), { key: "ArrowDown" });
  fireEvent.keyDown(within(pane).getByLabelText("客户姓名"), { key: "ArrowUp" });

  expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("WO100001");
  expect(callsTo("ticket.detail").map((call) => (call.input as { id: string }).id)).toEqual(["t1"]);
});

it("编辑已完结工单：完结信息原位保持只读", async () => {
  renderApp({
    path: "/tickets/t1",
    trpc: {
      "ticket.list": { items: rows, total: rows.length, page: 1, pageSize: 20 },
      "ticket.detail": detailPayload({
        status: "completed",
        displayStatus: "completed",
        completionTime: "2026-07-10T02:00:00.000Z",
        completionStatus: "正常完结",
      }),
      "channel.options": channelOptions,
      "ticketCategory.options": categoryOptions,
    },
  });
  const pane = await findPane();
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument());

  // 业务字段可编，完结信息不可编 —— 改完结走完结流程，不走整单编辑
  expect(within(pane).getByLabelText("客户姓名")).toBeInTheDocument();
  expect(within(pane).getByText("完结信息")).toBeInTheDocument();
  expect(within(pane).getByText("正常完结")).toBeInTheDocument();
  expect(within(pane).queryByLabelText("完结状态")).not.toBeInTheDocument();
});

describe("已修改高亮", () => {
  it("改过的字段标签后带「已修改」，取消后消失", async () => {
    const pane = await enterEditing();

    expect(within(pane).queryByText("已修改")).not.toBeInTheDocument();
    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    expect(within(pane).getAllByText("已修改")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "丢弃修改" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument());
    expect(within(pane).queryByText("已修改")).not.toBeInTheDocument();
  });

  it("清空成空值也算改过", async () => {
    const pane = await enterEditing();

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "" } });

    expect(within(pane).getAllByText("已修改")).toHaveLength(1);
  });
});

describe("目录停用项", () => {
  it("工单当前渠道已停用：以「（已停用）」入列，保存时原值仍合法", async () => {
    renderApp({
      path: "/tickets/t1",
      trpc: {
        "ticket.list": { items: rows, total: rows.length, page: 1, pageSize: 20 },
        "ticket.detail": detailPayload({
          channel: { id: "ch-legacy", name: "旧渠道", active: false },
        }),
        // 服务端 options 只给启用项，停用的当前值不在里面
        "channel.options": channelOptions,
        "ticketCategory.options": categoryOptions,
        "ticket.editComplaint": { id: "t1", workOrderNumber: "WO100001", status: "processing" },
      },
    });
    const pane = await findPane();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument(),
    );

    expect(within(pane).getByText("旧渠道（已停用）")).toBeInTheDocument();

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(editInputs()).toHaveLength(1));
    expect(editInputs()[0]?.channelId).toBe("ch-legacy");
  });
});

describe("时间字段的往返", () => {
  it("反馈时间预填当前值，未改则原样送回同一时刻", async () => {
    const pane = await enterEditing();

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(editInputs()).toHaveLength(1));
    expect(new Date(editInputs()[0]?.feedbackTime as string).toISOString()).toBe(
      "2026-07-09T01:00:00.000Z",
    );
  });

  it("清空反馈时间 → 提交 null (issue #62)", async () => {
    const pane = await enterEditing();

    fireEvent.click(within(pane).getByRole("button", { name: "清空时间" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(editInputs()).toHaveLength(1));
    expect(editInputs()[0]).toMatchObject({
      ticketId: "t1",
      feedbackTime: null,
      customerName: "王小明",
      channelId: "ch-baosi",
    });
  });
});

describe("未保存改动的三个出口", () => {
  async function makeDirty() {
    const pane = await enterEditing();
    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    return pane;
  }

  it("关闭详情：先弹丢弃确认，确认后回全宽表", async () => {
    await makeDirty();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("丢弃修改");

    fireEvent.click(within(dialog).getByRole("button", { name: "丢弃修改" }));

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  });

  it("↑/↓ 翻单：先弹丢弃确认，确认后才换单", async () => {
    await makeDirty();

    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowDown" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("丢弃修改");
    // 还没换单（弹窗开着时背景被 aria-hidden，故按 label 查）
    expect(document.querySelector('[aria-label="工单详情"]')).toHaveTextContent("WO100001");

    fireEvent.click(within(dialog).getByRole("button", { name: "丢弃修改" }));

    await findPane("WO100002");
  });

  it("取消编辑：先弹丢弃确认，确认后回只读", async () => {
    await makeDirty();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "丢弃修改" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "工单详情" })).toHaveTextContent("王小明");
  });

  it("确认框选继续编辑：留在编辑态，草稿还在", async () => {
    const pane = await makeDirty();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "继续编辑" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(within(pane).getByLabelText("客户姓名")).toHaveValue("王大明");
  });

  it("切单后编辑态不跟着走 —— 新单落在只读", async () => {
    renderAt();
    await findPane();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument(),
    );
    fireEvent.keyDown(screen.getByRole("region", { name: "工单详情" }), { key: "ArrowDown" });

    await findPane("WO100002");
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存修改" })).not.toBeInTheDocument();
  });
});
