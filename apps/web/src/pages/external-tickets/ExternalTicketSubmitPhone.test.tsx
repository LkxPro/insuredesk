import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

async function openForm(overrides: Record<string, unknown> = {}) {
  renderApp({
    path: "/external-tickets",
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      "externalTicket.list": { items: [], total: 0 },
      "externalTicket.findRelated": [],
      ...overrides,
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "新建工单" }));
  return screen.findByLabelText("投保人手机号（必填）");
}

describe("外部工单录入手机号", () => {
  it("手机号必填；不完整不查询且不能提交", async () => {
    const input = await openForm();
    expect(input).toBeRequired();
    fireEvent.change(screen.getByLabelText("工单原文"), { target: { value: "客户反馈" } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    expect(await screen.findByText("请填写投保人手机号")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1380000" } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));
    expect(await screen.findByText("请输入有效的 11 位手机号")).toBeInTheDocument();
    expect(callsTo("externalTicket.submit")).toHaveLength(0);
    expect(callsTo("externalTicket.findRelated")).toHaveLength(0);
  });

  it("查询自己的关联工单，改号与清空立即移除旧结果；关闭重开清草稿", async () => {
    const input = await openForm({
      "externalTicket.findRelated": ({ phone }: { phone: string }) =>
        phone === "13800001111"
          ? [
              {
                id: "own-ticket",
                workOrderNumber: "WO123456",
                customerName: "投保人",
                displayStatus: "processing",
                activityAt: "2026-10-28T01:00:00Z",
              },
            ]
          : [],
    });
    fireEvent.change(input, { target: { value: " 13800001111 " } });
    const link = await screen.findByRole("link", { name: "WO123456" });
    expect(link).toHaveAttribute("href", "/external-tickets/own-ticket");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByLabelText("工单原文")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交工单" })).not.toBeInTheDocument();
    expect(callsTo("externalTicket.findRelated").at(-1)?.input).toEqual({ phone: "13800001111" });
    expect(callsTo("ticket.findDuplicates")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "13900002222" } });
    expect(screen.queryByRole("link", { name: "WO123456" })).not.toBeInTheDocument();
    expect(await screen.findByText("暂无关联工单")).toBeInTheDocument();
    expect(screen.getByLabelText("工单原文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交工单" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("暂无关联工单")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("工单原文"), { target: { value: "草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByLabelText("工单原文")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建工单" }));
    expect(await screen.findByLabelText("投保人手机号（必填）")).toHaveValue("");
    expect(screen.getByLabelText("工单原文")).toHaveValue("");
    expect(screen.queryByRole("link", { name: "WO123456" })).not.toBeInTheDocument();
  });

  it("查询失败显示重试，保留草稿", async () => {
    let attempts = 0;
    const input = await openForm({
      "externalTicket.findRelated": () => {
        if (++attempts === 1) throw new Error("查询失败");
        return [];
      },
    });
    fireEvent.change(input, { target: { value: "13800001111" } });
    fireEvent.change(screen.getByLabelText("工单原文"), { target: { value: "草稿" } });
    expect(await screen.findByText("关联工单查询失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交工单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂无关联工单")).toBeInTheDocument();
    expect(screen.getByLabelText("工单原文")).toHaveValue("草稿");
  });
});
