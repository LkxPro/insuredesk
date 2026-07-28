import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { auth, callsTo, renderApp, toastSpies, userWith } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 机构详情页 /external-orgs/:id：头部信息 + 编辑/停用，可见字段整块展开。
 * 路由与列表同由 external_org.manage 把守。
 */

const ORG = {
  id: "o1",
  name: "机构甲",
  channelId: "ch1",
  channelName: "渠道一",
  visibleTicketFields: ["feedbackTime", "project"],
  userCount: 2,
  active: true,
};

const CHANNELS = [{ id: "ch1", name: "渠道一", active: true }];

function renderDetail(overrides: Record<string, unknown> = {}) {
  return renderApp({
    path: "/external-orgs/o1",
    role: TEST_ROLES.ADMIN,
    trpc: {
      "externalOrg.get": ORG,
      "channel.list": CHANNELS,
      ...overrides,
    },
  });
}

describe("路由守卫", () => {
  it("requires external_org.manage", () => {
    auth.user = userWith(TEST_ROLES.FRONTLINE_CS);
    renderApp({ path: "/external-orgs/o1" });
    expect(screen.getByText("你没有访问该页面的权限")).toBeInTheDocument();
    expect(callsTo("externalOrg.get")).toHaveLength(0);
  });
});

describe("头部与机构信息", () => {
  it("shows name, status, channel, user count and the whitelist fields", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "机构甲" })).toBeInTheDocument();
    expect(screen.getByText("启用")).toBeInTheDocument();
    expect(screen.getByText("渠道一")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("可见字段（2 个）")).toBeInTheDocument();
    expect(screen.getByText("反馈时间")).toBeInTheDocument();
    expect(screen.getByText("项目")).toBeInTheDocument();
  });

  it("null whitelist reads as 系统默认 with the default fields", async () => {
    renderDetail({ "externalOrg.get": { ...ORG, visibleTicketFields: null } });

    expect(await screen.findByText("可见字段（5 个，系统默认）")).toBeInTheDocument();
    expect(screen.getByText("工单号")).toBeInTheDocument();
    expect(screen.getByText("处理结果")).toBeInTheDocument();
  });

  it("a disabled org shows 已停用 and offers 启用", async () => {
    renderDetail({ "externalOrg.get": { ...ORG, active: false } });
    expect(await screen.findByText("已停用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用" })).toBeInTheDocument();
  });
});

describe("停用与启用", () => {
  it("停用 calls setActive and refetches", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "停用" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.setActive")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.setActive")[0]?.input).toEqual({ id: "o1", active: false });
    expect(toastSpies.success).toHaveBeenCalledWith("已停用机构");
    await waitFor(() => {
      expect(callsTo("externalOrg.get").length).toBeGreaterThan(1);
    });
  });
});

describe("编辑弹窗回填", () => {
  it("opens pre-filled and a rename-only save keeps the whitelist", async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByLabelText("机构名称")).toHaveValue("机构甲");
    expect(dialog.getByRole("checkbox", { name: "反馈时间" })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "项目" })).toBeChecked();

    fireEvent.change(dialog.getByLabelText("机构名称"), { target: { value: "机构甲改名" } });
    fireEvent.click(dialog.getByRole("button", { name: "更新" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.update")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.update")[0]?.input).toMatchObject({
      id: "o1",
      name: "机构甲改名",
      visibleTicketFields: ["feedbackTime", "project"],
    });
    // 保存后详情重取，展示新数据
    await waitFor(() => {
      expect(callsTo("externalOrg.get").length).toBeGreaterThan(1);
    });
  });
});
