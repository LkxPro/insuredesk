import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, type TestRole, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { detailPayload, listItem } from "./detail-pane-fixtures";

function renderDetail(
  overrides: Record<string, unknown> = {},
  role: TestRole = TEST_ROLES.CS_MANAGER,
) {
  auth.user = userWith(role);
  return renderApp({
    path: "/tickets/t1",
    trpc: {
      "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
      "ticket.detail": detailPayload(overrides),
      "ticket.addComment": {
        id: "t1",
        workOrderNumber: "WO100001",
        status: "processing",
        contactCount: 2,
      },
    },
  });
}

async function findPane() {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent("WO100001"));
  return pane;
}

function commentInputs() {
  return callsTo("ticket.addComment").map((call) => call.input as Record<string, unknown>);
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

it("输入框常驻时间线底部，无需先进编辑态", async () => {
  const pane = await (async () => {
    renderDetail();
    return findPane();
  })();

  expect(within(pane).getByLabelText("跟进备注")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
});

it("提交一次 = 一次 addComment，带工单 id 与备注原文", async () => {
  renderDetail();
  const pane = await findPane();

  fireEvent.change(within(pane).getByLabelText("跟进备注"), {
    target: { value: "已回电客户，承诺 T+1 反馈" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

  await waitFor(() => expect(commentInputs()).toHaveLength(1));
  expect(commentInputs()[0]).toMatchObject({
    ticketId: "t1",
    remark: "已回电客户，承诺 T+1 反馈",
  });
});

it("提交成功清空输入框并回读详情 —— 新记录由服务端进时间线", async () => {
  renderDetail();
  const pane = await findPane();

  const before = callsTo("ticket.detail").length;
  fireEvent.change(within(pane).getByLabelText("跟进备注"), { target: { value: "已回电客户" } });
  fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

  await waitFor(() => expect(within(pane).getByLabelText("跟进备注")).toHaveValue(""));
  expect(toastSpies.success).toHaveBeenCalled();
  await waitFor(() => expect(callsTo("ticket.detail").length).toBeGreaterThan(before));
});

it("空备注不发请求", async () => {
  renderDetail();
  await findPane();

  fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

  expect(commentInputs()).toHaveLength(0);
});

it("提交失败保留草稿并就地报错", async () => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
  renderApp({
    path: "/tickets/t1",
    trpc: {
      "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
      "ticket.detail": detailPayload(),
      "ticket.addComment": () => {
        throw new Error("工单已完结，无法继续跟进");
      },
    },
  });
  const pane = await findPane();

  fireEvent.change(within(pane).getByLabelText("跟进备注"), { target: { value: "已回电客户" } });
  fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

  await waitFor(() => expect(screen.getByText("工单已完结，无法继续跟进")).toBeInTheDocument());
  expect(within(pane).getByLabelText("跟进备注")).toHaveValue("已回电客户");
});

describe("下次联系时间与仅内部可见", () => {
  it("未设下次联系时间 → 提交 null（清掉上一次的计划）", async () => {
    renderDetail();
    const pane = await findPane();

    fireEvent.change(within(pane).getByLabelText("跟进备注"), { target: { value: "已回电" } });
    fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

    await waitFor(() => expect(commentInputs()).toHaveLength(1));
    expect(commentInputs()[0]?.nextContactTime).toBeNull();
  });

  it("半填的下次联系时间就地拦下，不发请求 (issue #62)", async () => {
    renderDetail();
    const pane = await findPane();

    fireEvent.change(within(pane).getByLabelText("跟进备注"), { target: { value: "已回电" } });
    await userEvent.type(within(pane).getByLabelText("下次联系时间的时分"), "0930");
    fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

    await waitFor(() =>
      expect(screen.getByText("下次联系时间需同时选择日期和时间")).toBeInTheDocument(),
    );
    expect(commentInputs()).toHaveLength(0);
    expect(within(pane).getByLabelText("下次联系时间的时分")).toHaveValue("09:30");
  });

  it("勾选仅内部可见 → internalOnly: true，提交后复位 (issue #151)", async () => {
    renderDetail();
    const pane = await findPane();

    fireEvent.change(within(pane).getByLabelText("跟进备注"), { target: { value: "内部备注" } });
    fireEvent.click(within(pane).getByLabelText("仅内部可见"));
    fireEvent.click(screen.getByRole("button", { name: "提交跟进" }));

    await waitFor(() => expect(commentInputs()).toHaveLength(1));
    expect(commentInputs()[0]?.internalOnly).toBe(true);
    await waitFor(() => expect(within(pane).getByLabelText("仅内部可见")).not.toBeChecked());
  });
});

describe("门控", () => {
  it("已完结工单没有输入框", async () => {
    renderDetail({ status: "completed", displayStatus: "completed" });
    const pane = await findPane();

    expect(within(pane).queryByLabelText("跟进备注")).not.toBeInTheDocument();
    expect(within(pane).getByRole("list")).toBeInTheDocument();
  });

  it("无 ticket.process 权限没有输入框", async () => {
    renderDetail({}, { name: "只读", permissions: ["ticket.view"] });
    const pane = await findPane();

    expect(within(pane).queryByLabelText("跟进备注")).not.toBeInTheDocument();
  });
});
