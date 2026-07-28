import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { callsTo, renderApp } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 外部机构列表：行点击/账号数进详情，快捷编辑与停用保留在行上。编辑弹窗
 * 打开时回填当前白名单，仅改名保存后 visibleTicketFields 原样带回服务端。
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

function renderList(overrides: Record<string, unknown> = {}) {
  return renderApp({
    path: "/external-orgs",
    role: TEST_ROLES.ADMIN,
    trpc: {
      "externalOrg.list": [ORG],
      "externalOrg.get": ORG,
      "channel.list": CHANNELS,
      ...overrides,
    },
  });
}

describe("列表渲染", () => {
  it("shows the whitelist size, falling back to 系统默认 5 when null", async () => {
    renderList({
      "externalOrg.list": [ORG, { ...ORG, id: "o2", name: "机构乙", visibleTicketFields: null }],
    });

    const rowA = (await screen.findByText("机构甲")).closest("tr") as HTMLElement;
    expect(within(rowA).getByText("2", { selector: "td" })).toBeInTheDocument();
    const rowB = screen.getByText("机构乙").closest("tr") as HTMLElement;
    expect(within(rowB).getByText("5")).toBeInTheDocument();
  });
});

describe("进入详情", () => {
  it("机构名 and 账号数 are links to the detail page (keyboard path)", async () => {
    renderList();
    await screen.findByText("机构甲");

    expect(screen.getByRole("link", { name: "机构甲" })).toHaveAttribute(
      "href",
      "/external-orgs/o1",
    );
    expect(screen.getByRole("link", { name: "2" })).toHaveAttribute("href", "/external-orgs/o1");
  });

  it("clicking anywhere on the row navigates too", async () => {
    renderList();
    fireEvent.click(await screen.findByText("渠道一"));

    // 详情页拉自己的 query，说明路由已经切过去
    await waitFor(() => {
      expect(callsTo("externalOrg.get")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.get")[0]?.input).toEqual({ id: "o1" });
  });

  it("row actions stay on the list page", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "停用" }));

    await waitFor(() => {
      expect(callsTo("externalOrg.setActive")).toHaveLength(1);
    });
    expect(callsTo("externalOrg.setActive")[0]?.input).toEqual({ id: "o1", active: false });
    expect(callsTo("externalOrg.get")).toHaveLength(0);
  });
});

describe("编辑弹窗回填", () => {
  it("pre-selects the org's current whitelist when opened", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("可见字段（2 个已选）")).toBeInTheDocument();
    expect(dialog.getByRole("checkbox", { name: "反馈时间" })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "项目" })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "经纪主体" })).not.toBeChecked();
  });

  it("rename-only save keeps the whitelist in the update payload", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    const dialog = within(await screen.findByRole("dialog"));
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
  });
});
