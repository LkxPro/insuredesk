import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp, type TestRole } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import {
  callbackDeliveryPayload,
  detailPayload,
  listItem,
  refundDetailPayload,
} from "./detail-pane-fixtures";

function renderDetail(
  overrides: Record<string, unknown> = {},
  role: TestRole = TEST_ROLES.CS_MANAGER,
) {
  return renderApp({
    path: "/tickets/t1",
    role,
    trpc: {
      "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
      "ticket.detail": detailPayload(overrides),
      "ticket.updateRefundCompensation": () => ({
        id: "t1",
        workOrderNumber: "WO100001",
        compensationAmount: "20.5",
      }),
      "ticket.redeliverCallback": () => ({ id: "delivery-1", status: "pending" }),
    },
  });
}

const refundTicket = (overrides: Record<string, unknown> = {}) => ({
  kindKey: "refund_exception",
  source: "jb-insurance",
  refundDetail: refundDetailPayload(),
  ...overrides,
});

async function findPane() {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent("WO100001"));
  return pane;
}

function refundSection(pane: HTMLElement) {
  const heading = within(pane).getByText("退费信息");
  return heading.closest("section") as HTMLElement;
}

describe("退费模块渲染", () => {
  it("退费异常工单渲染退费模块：异常原因/应退金额/申请时间/投保人信息/期次明细全只读", async () => {
    renderDetail(refundTicket());
    const pane = await findPane();
    const section = refundSection(pane);

    expect(within(section).getByText("卡异常-退费失败")).toBeInTheDocument();
    expect(within(section).getByText("银行卡状态异常，退款被退回")).toBeInTheDocument();
    expect(within(section).getByText("100.00")).toBeInTheDocument();
    expect(within(section).getByText("2026-08-18 16:40")).toBeInTheDocument();
    expect(within(section).getByText("泰康在线")).toBeInTheDocument();
    expect(within(section).getByText("泰康百万医疗险")).toBeInTheDocument();
    expect(within(section).getByText("张三")).toBeInTheDocument();
    expect(within(section).getByText("SO-20260818")).toBeInTheDocument();
    expect(within(section).getByText("PAY20260818001")).toBeInTheDocument();
    expect(within(section).getByText("PAY20260818002")).toBeInTheDocument();
    expect(within(section).getByText("60.00")).toBeInTheDocument();
    expect(within(section).getByText("40.00")).toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
    // 实退金额不单列（合同定义为应退原样回传）
    expect(within(section).queryByText("实退金额")).not.toBeInTheDocument();
  });

  it("投诉工单不渲染退费模块", async () => {
    renderDetail();
    const pane = await findPane();
    expect(within(pane).queryByText("退费信息")).not.toBeInTheDocument();
  });

  it("主表单编辑态下，推送盖章的标准字段只读、未盖章字段可编辑", async () => {
    renderDetail(refundTicket());
    const pane = await findPane();
    fireEvent.click(within(pane).getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(within(pane).getByRole("button", { name: "保存修改" })).toBeInTheDocument(),
    );

    expect(within(pane).queryByLabelText("客户姓名")).not.toBeInTheDocument();
    expect(within(pane).queryByLabelText("客户电话（投保人）")).not.toBeInTheDocument();
    expect(within(pane).queryByLabelText("内部订单号")).not.toBeInTheDocument();
    expect(within(pane).getByText("张三")).toBeInTheDocument();
    expect(within(pane).getByLabelText("项目（保司）")).toBeInTheDocument();
  });
});

describe("补偿金编辑", () => {
  it("ticket.process 持有者可填补偿金；非法金额前端拦截不发请求", async () => {
    renderDetail(refundTicket());
    const pane = await findPane();
    const section = refundSection(pane);

    expect(within(section).getByText("无补偿")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "修改" }));
    const input = within(section).getByLabelText("补偿金");

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.click(within(section).getByRole("button", { name: "保存" }));
    expect(
      within(section).getByText("补偿金须为不小于 0 的金额（最多两位小数）"),
    ).toBeInTheDocument();
    expect(callsTo("ticket.updateRefundCompensation")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "20.5" } });
    fireEvent.click(within(section).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(callsTo("ticket.updateRefundCompensation")).toHaveLength(1));
    expect(callsTo("ticket.updateRefundCompensation")[0]?.input).toMatchObject({
      ticketId: "t1",
      compensationAmount: "20.5",
    });
  });

  it("留空 = 无补偿：清空已填补偿金", async () => {
    renderDetail(
      refundTicket({ refundDetail: refundDetailPayload({ compensationAmount: "20.50" }) }),
    );
    const pane = await findPane();
    const section = refundSection(pane);

    expect(within(section).getByText("20.50")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "修改" }));
    const input = within(section).getByLabelText("补偿金");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(within(section).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(callsTo("ticket.updateRefundCompensation")).toHaveLength(1));
    expect(callsTo("ticket.updateRefundCompensation")[0]?.input).toMatchObject({
      ticketId: "t1",
      compensationAmount: null,
    });
  });

  it("工单完结后补偿金不再可编辑", async () => {
    renderDetail(refundTicket({ status: "completed", displayStatus: "completed" }));
    const pane = await findPane();
    const section = refundSection(pane);
    expect(within(section).queryByRole("button", { name: "修改" })).not.toBeInTheDocument();
  });

  it("无 ticket.process 权限只读", async () => {
    renderDetail(refundTicket(), TEST_ROLES.READ_ONLY);
    const pane = await findPane();
    const section = refundSection(pane);
    expect(within(section).queryByRole("button", { name: "修改" })).not.toBeInTheDocument();
  });
});

describe("回调投递状态", () => {
  it("死信时 ticket.process 持有者可见「重新投递」，点击触发 redeliverCallback", async () => {
    renderDetail(
      refundTicket({
        callbackDelivery: callbackDeliveryPayload({
          status: "dead",
          attempts: 3,
          lastError: "平台 HTTP 500",
        }),
      }),
    );
    const pane = await findPane();
    const section = refundSection(pane);

    expect(within(section).getByText("投递失败（死信）")).toBeInTheDocument();
    expect(within(section).getByText("平台 HTTP 500")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "重新投递" }));
    await waitFor(() => expect(callsTo("ticket.redeliverCallback")).toHaveLength(1));
    expect(callsTo("ticket.redeliverCallback")[0]?.input).toMatchObject({
      deliveryId: "delivery-1",
    });
  });

  it("待投递/已投递不出「重新投递」", async () => {
    const first = renderDetail(
      refundTicket({ callbackDelivery: callbackDeliveryPayload({ status: "pending" }) }),
    );
    let pane = await findPane();
    expect(
      within(refundSection(pane)).queryByRole("button", { name: "重新投递" }),
    ).not.toBeInTheDocument();
    first.unmount();

    renderDetail(
      refundTicket({
        callbackDelivery: callbackDeliveryPayload({
          status: "delivered",
          deliveredAt: "2026-08-25T02:00:00.000Z",
        }),
      }),
    );
    pane = await findPane();
    const section = refundSection(pane);
    expect(within(section).getByText("已投递")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "重新投递" })).not.toBeInTheDocument();
  });

  it("死信但无 ticket.process 权限不出「重新投递」", async () => {
    renderDetail(
      refundTicket({ callbackDelivery: callbackDeliveryPayload({ status: "dead" }) }),
      TEST_ROLES.READ_ONLY,
    );
    const pane = await findPane();
    expect(
      within(refundSection(pane)).queryByRole("button", { name: "重新投递" }),
    ).not.toBeInTheDocument();
  });

  it("未完结无投递记录时回调状态落 —", async () => {
    renderDetail(refundTicket());
    const pane = await findPane();
    const section = refundSection(pane);
    const cell = within(section).getByText("回调投递状态").closest("div");
    expect(cell).toHaveTextContent("—");
  });
});
