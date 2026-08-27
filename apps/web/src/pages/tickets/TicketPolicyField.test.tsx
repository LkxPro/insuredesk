import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";
import { detailPayload, listItem, slaPolicyOptions } from "./detail-pane-fixtures";

// Radix Select 用 jsdom 未实现的 pointer-capture / scroll API 驱动下拉
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});

beforeEach(() => {
  auth.user = userWith(TEST_ROLES.CS_MANAGER);
});

describe("建单表单的策略下拉", () => {
  function renderCreate() {
    return renderApp({
      path: "/tickets/new",
      trpc: {
        "sla.options": slaPolicyOptions,
      },
    });
  }

  it("选项来自 sla.options：名称 + 一行说明小字", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("combobox", { name: /^时效策略/ }));

    const normal = await screen.findByRole("option", { name: /一般投诉/ });
    expect(within(normal).getByText("一般投诉")).toBeInTheDocument();
    expect(within(normal).getByText("常规投诉：48 小时处理时限。")).toBeInTheDocument();
    const urgent = screen.getByRole("option", { name: /特急投诉/ });
    expect(within(urgent).getByText("特急投诉：不设处理时限，滚动跟进。")).toBeInTheDocument();
  });

  it("手工建单只产投诉单：下拉按投诉组取数（kindKey=complaint）", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    await waitFor(() =>
      expect(
        callsTo("sla.options").some(
          (call) => (call.input as { kindKey?: string } | undefined)?.kindKey === "complaint",
        ),
      ).toBe(true),
    );
  });

  it("选中策略后提交：slaPolicyId 随行，不携带旧投诉等级文本键", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("combobox", { name: /^时效策略/ }));
    fireEvent.click(await screen.findByRole("option", { name: /特急投诉/ }));

    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    await waitFor(() => expect(callsTo("ticket.create")).toHaveLength(1));
    const input = callsTo("ticket.create")[0]?.input as Record<string, unknown>;
    expect(input.slaPolicyId).toBe("pol-urgent");
    expect(input).not.toHaveProperty("complaintLevel");
  });

  it("可不选：未指定策略提交 slaPolicyId 为 null", async () => {
    renderCreate();
    await screen.findByRole("heading", { name: "新建工单" });

    fireEvent.click(screen.getByRole("button", { name: "创建工单" }));

    await waitFor(() => expect(callsTo("ticket.create")).toHaveLength(1));
    const input = callsTo("ticket.create")[0]?.input as Record<string, unknown>;
    expect(input.slaPolicyId).toBeNull();
  });
});

describe("详情编辑的策略下拉", () => {
  function renderDetail(detail: Record<string, unknown>) {
    return renderApp({
      path: "/tickets/t1",
      trpc: {
        "ticket.list": { items: [listItem()], total: 1, page: 1, pageSize: 20 },
        "ticket.detail": detail,
        "sla.options": slaPolicyOptions,
        "ticket.editComplaint": { id: "t1", workOrderNumber: "WO100001", status: "processing" },
      },
    });
  }

  async function enterEditing() {
    const pane = await screen.findByRole("region", { name: "工单详情" });
    await waitFor(() => expect(pane).toHaveTextContent("WO100001"));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument(),
    );
    return pane;
  }

  it("当前策略已停用：注入「（已停用）」占位项，保存保持原引用", async () => {
    renderDetail(
      detailPayload({
        slaPolicyId: "pol-legacy",
        slaPolicy: { id: "pol-legacy", name: "旧策略", active: false },
      }),
    );
    const pane = await enterEditing();

    fireEvent.click(within(pane).getByRole("combobox", { name: /^时效策略/ }));
    expect(await screen.findByRole("option", { name: "旧策略（已停用）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /一般投诉/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.change(within(pane).getByLabelText("客户姓名"), { target: { value: "王大明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(callsTo("ticket.editComplaint")).toHaveLength(1));
    expect(callsTo("ticket.editComplaint")[0]?.input).toMatchObject({ slaPolicyId: "pol-legacy" });
  });

  it("改选其他启用策略：提交新的 slaPolicyId", async () => {
    renderDetail(detailPayload());
    const pane = await enterEditing();

    fireEvent.click(within(pane).getByRole("combobox", { name: /^时效策略/ }));
    fireEvent.click(await screen.findByRole("option", { name: /特急投诉/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(callsTo("ticket.editComplaint")).toHaveLength(1));
    expect(callsTo("ticket.editComplaint")[0]?.input).toMatchObject({ slaPolicyId: "pol-urgent" });
  });

  it("清空策略（未设置）：提交 slaPolicyId 为 null", async () => {
    renderDetail(detailPayload());
    const pane = await enterEditing();

    fireEvent.click(within(pane).getByRole("combobox", { name: /^时效策略/ }));
    fireEvent.click(await screen.findByRole("option", { name: "未设置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(callsTo("ticket.editComplaint")).toHaveLength(1));
    expect(callsTo("ticket.editComplaint")[0]?.input).toMatchObject({ slaPolicyId: null });
  });

  it("编辑下拉按工单的种类取数：kindKey 随详情下发", async () => {
    renderDetail(detailPayload({ kindKey: "refund_exception" }));
    await enterEditing();

    await waitFor(() =>
      expect(
        callsTo("sla.options").some(
          (call) =>
            (call.input as { kindKey?: string } | undefined)?.kindKey === "refund_exception",
        ),
      ).toBe(true),
    );
  });
});
