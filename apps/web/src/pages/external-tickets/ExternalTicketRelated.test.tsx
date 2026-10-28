import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

function renderRelated(relatedTickets: Record<string, unknown>[]) {
  renderApp({
    path: "/external-tickets/t1",
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      "externalTicket.list": { items: [], total: 0 },
      "externalTicket.detail": {
        ticket: {
          id: "t1",
          workOrderNumber: "WO100001",
          status: "processing",
          submissionText: "客户反馈",
          policyNumbers: ["P123"],
          phone: "13800000001",
          contactPhone: null,
        },
        processLogs: [],
        relatedTickets,
      },
    },
  });
}

describe("外部工单关联提醒", () => {
  it("展示关联记录、展开收起，链接指向外部详情且不调用内部查重接口", async () => {
    renderRelated([
      {
        id: "t2",
        workOrderNumber: "WO100002",
        displayStatus: "processing",
        activityAt: "2026-10-27T02:00:00.000Z",
        activityText: "已联系客户",
      },
      {
        id: "t3",
        workOrderNumber: "WO100003",
        displayStatus: "completed",
        activityAt: "2026-10-26T02:00:00.000Z",
        activityText: "已完成处理",
      },
    ]);

    expect(await screen.findByText("该客户另有 2 个工单")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WO100002" })).toHaveAttribute(
      "href",
      "/external-tickets/t2",
    );
    expect(screen.getByText("已联系客户")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "WO100003" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开其余 1 个工单" }));
    expect(screen.getByRole("link", { name: "WO100003" })).toHaveAttribute(
      "href",
      "/external-tickets/t3",
    );
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByRole("link", { name: "WO100003" })).not.toBeInTheDocument();
    expect(callsTo("ticket.findDuplicates")).toHaveLength(0);
  });

  it("无关联时不显示提醒", async () => {
    renderRelated([]);
    const pane = await screen.findByRole("region", { name: "工单详情" });
    expect(await within(pane).findByText("客户反馈")).toBeInTheDocument();
    expect(within(pane).queryByText(/该客户另有/)).not.toBeInTheDocument();
  });
});
