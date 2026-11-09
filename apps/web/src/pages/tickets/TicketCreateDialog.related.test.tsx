import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import "./TicketsPage";
import { detailPayload } from "./detail-pane-fixtures";

it("命中后禁止新建，可查看原单并追加内部备注，成功后停留原单", async () => {
  auth.user = userWith({
    name: "录入",
    permissions: ["ticket.view", "ticket.create", "ticket.relate_all"],
  });
  const logs: Record<string, unknown>[] = [];
  renderApp({
    path: "/tickets/new",
    trpc: {
      "ticket.findRelated": [
        {
          id: "t1",
          workOrderNumber: "WO100001",
          customerName: "王小明",
          displayStatus: "unassigned",
          matchedFields: ["phone"],
          activityAt: "2026-07-09T02:00:00Z",
        },
      ],
      "ticket.relatedDetail": () =>
        detailPayload({ status: "unassigned", displayStatus: "unassigned", processLogs: logs }),
      "ticket.addRelatedNote": () => {
        logs.push({
          id: "n1",
          action: "internal_note",
          operatorName: "测试用户",
          at: "2026-07-09T03:00:00Z",
          remark: "客户新增信息",
          internalOnly: true,
        });
        return { id: "t1" };
      },
    },
  });
  fireEvent.change(await screen.findByLabelText("客户电话（投保人）"), {
    target: { value: "13800000001" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "WO100001" }));
  expect(await screen.findByLabelText("补充备注（仅内部可见）")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("补充备注（仅内部可见）"), {
    target: { value: "客户新增信息" },
  });
  fireEvent.click(screen.getByRole("button", { name: "追加备注" }));
  expect(await screen.findByText("客户新增信息")).toBeInTheDocument();
  expect(callsTo("ticket.create")).toEqual([]);
  expect(callsTo("ticket.addRelatedNote")[0]?.input).toMatchObject({
    ticketId: "t1",
    match: { phone: "13800000001" },
    remark: "客户新增信息",
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "创建工单" })).toBeDisabled());
  expect(screen.queryByRole("button", { name: "仍要创建" })).not.toBeInTheDocument();
});

it("所有匹配可选，原单提交前完结时刷新匹配，无剩余命中可继续新建", async () => {
  auth.user = userWith({
    name: "录入",
    permissions: ["ticket.view", "ticket.create", "ticket.relate_all"],
  });
  let completed = false;
  const matches = Array.from({ length: 22 }, (_, index) => ({
    id: `t${index}`,
    workOrderNumber: `WO${100000 + index}`,
    displayStatus: "unassigned",
    customerName: "王小明",
    matchedFields: ["phone"],
  }));
  renderApp({
    path: "/tickets/new",
    trpc: {
      "ticket.findRelated": () => (completed ? [] : matches),
      "ticket.relatedDetail": () => {
        if (completed) throw Object.assign(new Error("工单已完结"), { trpcCode: "NOT_FOUND" });
        return detailPayload({ id: "t21", workOrderNumber: "WO100021" });
      },
      "ticket.addRelatedNote": () => {
        completed = true;
        throw Object.assign(new Error("工单已完结"), { trpcCode: "PRECONDITION_FAILED" });
      },
    },
  });
  fireEvent.change(await screen.findByLabelText("客户电话（投保人）"), {
    target: { value: "13800000001" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "WO100021" }));
  fireEvent.change(await screen.findByLabelText("补充备注（仅内部可见）"), {
    target: { value: "新信息" },
  });
  fireEvent.click(screen.getByRole("button", { name: "追加备注" }));
  expect(await screen.findByText("工单加载失败")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "创建工单" })).toBeEnabled());
  expect(screen.getByLabelText("客户电话（投保人）")).toHaveValue("13800000001");
  expect(callsTo("ticket.create")).toEqual([]);
});
