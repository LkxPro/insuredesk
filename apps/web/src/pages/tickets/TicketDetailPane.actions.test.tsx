import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { completionStatusOptions, detailPayload, listItem } from "./detail-pane-fixtures";

/**
 * 从分栏详情发起的两个二级动作：完结与删除。两者都复用既有弹窗，分栏只负责按
 * 权限与状态决定按钮在不在（那部分在 TicketDetailPane.test.tsx），这里测弹窗
 * 里的必填与提交契约，以及删除后离开处理态。
 */

// Radix Select 需要 jsdom 未实现的 pointer-capture / scroll API
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});

function renderDetail(role = TEST_ROLES.ADMIN) {
  auth.user = userWith(role);
  return renderApp({
    path: "/tickets/t1",
    trpc: {
      "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
      "ticket.detail": detailPayload(),
      "completionStatus.options": completionStatusOptions,
      "ticket.resolve": {
        id: "t1",
        workOrderNumber: "WO100001",
        status: "completed",
        completionStatus: "正常完结",
      },
      "ticket.delete": { id: "t1", workOrderNumber: "WO100001" },
    },
  });
}

async function findPane() {
  const pane = await screen.findByRole("region", { name: "工单详情" });
  await waitFor(() => expect(pane).toHaveTextContent("WO100001"));
  return pane;
}

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.ADMIN);
});

describe("完结", () => {
  async function openResolve() {
    renderDetail();
    await findPane();
    fireEvent.click(screen.getByRole("button", { name: "完结工单" }));
    return screen.findByRole("dialog");
  }

  it("完结状态与完结备注都填齐才能提交", async () => {
    const dialog = await openResolve();

    // 两个必填都空 → 确认按钮不可点
    expect(within(dialog).getByRole("button", { name: "确认完结" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("完结备注"), {
      target: { value: "已与客户达成一致" },
    });
    // 只有备注仍不够
    expect(within(dialog).getByRole("button", { name: "确认完结" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "正常完结" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "确认完结" })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认完结" }));

    await waitFor(() => expect(callsTo("ticket.resolve")).toHaveLength(1));
    expect(callsTo("ticket.resolve")[0]?.input).toMatchObject({
      ticketId: "t1",
      completionStatusId: "cs-normal",
      remark: "已与客户达成一致",
    });
  });

  it("完结成功关掉弹窗、回读详情，处理态留在原地", async () => {
    const dialog = await openResolve();
    const before = callsTo("ticket.detail").length;

    fireEvent.change(within(dialog).getByLabelText("完结备注"), { target: { value: "已解决" } });
    fireEvent.click(within(dialog).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "正常完结" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认完结" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toastSpies.success).toHaveBeenCalled();
    // 状态/完结信息/时间线都在服务端变 → 回读
    await waitFor(() => expect(callsTo("ticket.detail").length).toBeGreaterThan(before));
    // 没被弹到列表：完结后还能继续看这单
    expect(await findPane()).toBeInTheDocument();
  });

  it("只列完结状态目录的启用项", async () => {
    auth.user = userWith(TEST_ROLES.ADMIN);
    renderApp({
      path: "/tickets/t1",
      trpc: {
        "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
        "ticket.detail": detailPayload(),
        // 服务端 options 已过滤停用项，前端照单渲染
        "completionStatus.options": [{ id: "cs-normal", name: "正常完结" }],
      },
    });
    await findPane();
    fireEvent.click(screen.getByRole("button", { name: "完结工单" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("combobox"));

    expect(await screen.findByRole("option", { name: "正常完结" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});

describe("删除", () => {
  async function openDelete() {
    renderDetail();
    await findPane();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    return screen.findByRole("dialog");
  }

  it("只在二次确认后才发 ticket.delete，随后离开处理态回列表", async () => {
    const dialog = await openDelete();

    // 弹窗开着但还没确认 → 不发请求
    expect(callsTo("ticket.delete")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(callsTo("ticket.delete")).toHaveLength(1));
    expect(callsTo("ticket.delete")[0]?.input).toMatchObject({ ticketId: "t1" });
    // 单子没了，处理态无从停留
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "工单详情" })).not.toBeInTheDocument();
  });

  it("取消不发请求，处理态原样保留", async () => {
    const dialog = await openDelete();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(callsTo("ticket.delete")).toHaveLength(0);
    expect(await findPane()).toBeInTheDocument();
  });
});
