import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { calls, callsTo, renderApp, toastSpies } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部端主页：提交即首屏。提交与 我的工单 是同页两个 tab，状态住在 ?tab
 * 里（缺省 = 提交），列表筛选参数跨 tab 保留，深链可直接落到带筛选的列表。
 * 提交页大文本框收工单原文（1–2000 字必填），本地校验对齐服务端
 * （原文创建后不可编辑）。
 */

function renderHome(path = "/external-tickets", trpc: Record<string, unknown> = {}) {
  return renderApp({
    path,
    role: TEST_ROLES.EXTERNAL,
    isExternal: true,
    trpc: {
      // 列表 tab 的列头随 visibleFields 渲染；给个最小白名单让 tab 用例有东西可等
      "externalTicket.list": { items: [], total: 0, visibleFields: ["workOrderNumber"] },
      ...trpc,
    },
  });
}

describe("tab 布局", () => {
  it("lands on the submit tab by default — 大文本框即主操作", async () => {
    renderHome();
    expect(await screen.findByLabelText("工单原文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交工单" })).toBeInTheDocument();
    // 列表 tab 的内容不在首屏
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
  });

  it("外部用户登录经 index redirect 落到提交主页", async () => {
    renderHome("/");
    expect(await screen.findByLabelText("工单原文")).toBeInTheDocument();
  });

  it("?tab=list shows the ticket list instead", async () => {
    renderHome("/external-tickets?tab=list");
    expect((await screen.findAllByRole("columnheader")).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("工单原文")).not.toBeInTheDocument();
  });

  it("tab 链接保留当前列表筛选参数，切走再切回筛选不丢", async () => {
    renderHome("/external-tickets?tab=list&status=completed");
    await screen.findAllByRole("columnheader");

    expect(screen.getByRole("tab", { name: "提交工单" })).toHaveAttribute(
      "href",
      "/external-tickets?status=completed",
    );
    expect(screen.getByRole("tab", { name: "我的工单" })).toHaveAttribute(
      "href",
      "/external-tickets?tab=list&status=completed",
    );
  });

  it("当前 tab 高亮，另一个是待激活态", async () => {
    renderHome("/external-tickets?tab=list");
    await screen.findAllByRole("columnheader");

    expect(screen.getByRole("tab", { name: "我的工单" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "提交工单" })).toHaveAttribute("data-state", "inactive");
  });
});

describe("提交工单", () => {
  it("submits the trimmed 原文, toasts and clears the box", async () => {
    renderHome("/external-tickets", {
      "externalTicket.submit": { id: "t2", workOrderNumber: "WO100002" },
    });
    const box = await screen.findByLabelText("工单原文");

    fireEvent.change(box, { target: { value: "  客户要求退保  " } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));

    await waitFor(() => {
      expect(callsTo("externalTicket.submit")).toHaveLength(1);
    });
    // 前后空白在提交前裁掉
    expect(callsTo("externalTicket.submit")[0]?.input).toEqual({
      submissionText: "客户要求退保",
    });
    expect(toastSpies.success).toHaveBeenCalledWith("工单 WO100002 已提交");
    await waitFor(() => {
      expect(screen.getByLabelText("工单原文")).toHaveValue("");
    });

    // 列表 tab 带上新单：切过去会拉到列表数据（提交时缓存已被作废）
    fireEvent.click(screen.getByRole("tab", { name: "我的工单" }));
    await waitFor(() => {
      expect(callsTo("externalTicket.list").length).toBeGreaterThan(0);
    });
  });

  it("caps 原文 at 2000 chars and shows the counter", async () => {
    renderHome();
    const box = await screen.findByLabelText("工单原文");
    expect(box).toHaveAttribute("maxLength", "2000");

    fireEvent.change(box, { target: { value: "字".repeat(12) } });
    expect(screen.getByText("12 / 2000 字，提交后不可修改。")).toBeInTheDocument();
  });

  it("blocks an empty 原文 client-side", async () => {
    renderHome();
    await screen.findByLabelText("工单原文");

    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));

    expect(await screen.findByText("请填写工单原文")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "externalTicket.submit")).toBe(false);
  });

  it("surfaces a server-side rejection on the page", async () => {
    renderHome("/external-tickets", {
      "externalTicket.submit": () => {
        throw new Error("原文含有敏感信息");
      },
    });
    const box = await screen.findByLabelText("工单原文");

    fireEvent.change(box, { target: { value: "客户电话 13800001111" } });
    fireEvent.click(screen.getByRole("button", { name: "提交工单" }));

    expect(await screen.findByText("原文含有敏感信息")).toBeInTheDocument();
    expect(screen.getByLabelText("工单原文")).toHaveValue("客户电话 13800001111");
  });
});
