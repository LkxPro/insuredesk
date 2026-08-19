import type { Permission } from "@insuredesk/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp, type TestRole, type TrpcOverrides } from "@/test/renderApp";
import { TEST_ROLES } from "@/test/roles";

/**
 * 入口门控矩阵: every permission-gated entry point across /tickets and the
 * detail dialog — 持有→可见 / 缺失→不可见 — driven off renderApp's
 * hasPermission seam in one table. 行状态是门控的第二轴: 终态行不可分配不可
 * 选, 完结/跟进只在 in-flight (assigned/processing) 出现. 点进入口之后的交
 * 互流留在各入口自己的文件 (TicketsPage.* / TicketDetailDialog.*).
 */

/** 客服主管 plus the manually 勾选-ed ticket.import. */
const IMPORTER: TestRole = {
  name: "客服主管",
  permissions: [...TEST_ROLES.CS_MANAGER.permissions, "ticket.import"] as Permission[],
};

/** 分配-only: proves ticket.process alone gates 完结, and vice versa. */
const ASSIGN_ONLY: TestRole = {
  name: "仅分配",
  permissions: ["ticket.view", "ticket.view_all", "ticket.assign"] as Permission[],
};

function listItem(
  id: string,
  workOrderNumber: string,
  status: string,
  assignee: { id: string; name: string } | null,
) {
  return {
    id,
    workOrderNumber,
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "理赔投诉",
    complaintLevel: "一般投诉",
    customerName: "王小明",
    policyNumbers: ["P2026070900123"],
    status,
    displayStatus: status,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.name ?? null,
    dueAt: "2026-07-11T02:00:00.000Z",
  };
}

/** One row per status: the row-state axis of the list-page gates. */
const LIST_ITEMS = [
  listItem("t1", "WO100001", "unassigned", null),
  listItem("t2", "WO100002", "assigned", { id: "u-zhang", name: "张客服" }),
  listItem("t3", "WO100003", "processing", { id: "u-zhang", name: "张客服" }),
  listItem("t4", "WO100004", "completed", { id: "u-zhang", name: "张客服" }),
];

/** serializeTicketDetail wire shape; 未分配单没有责任人. */
function detailPayload(status: string) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-09T02:00:00.000Z",
    updatedAt: "2026-07-09T03:00:00.000Z",
    feedbackTime: "2026-07-09T01:00:00.000Z",
    source: "manual",
    createdBy: "测试用户",
    channel: { id: "ch-baosi", name: "保司", active: true },
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    internalOrderNumber: null,
    policyNumbers: ["P2026070900123"],
    userComplaintChannel: { id: "ucc-hotline", name: "保司400热线", active: true },
    complaintReceiveChannel: null,
    customerName: "王小明",
    phone: "13800000001",
    contactPhone: null,
    customerRequest: "对理赔进度有异议",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    contactTime: null,
    contactId: null,
    category: { id: "cat-claims", name: "理赔投诉", active: true },
    complaintLevel: "一般投诉",
    priority: null,
    followUpFrequency: "每天跟进",
    firstResponseRequirement: "24小时内",
    status,
    displayStatus: status,
    assigneeId: status === "unassigned" ? null : "u1",
    assigneeName: status === "unassigned" ? null : "测试用户",
    assignedAt: "2026-07-09T03:00:00.000Z",
    dueAt: "2026-07-11T02:00:00.000Z",
    nextContactTime: null,
    contactCount: 1,
    completionTime: null,
    completionStatus: null,
    processLogs: [
      {
        id: "log1",
        operatorId: "u1",
        operatorName: "测试用户",
        operatorAvatar: null,
        action: "create",
        from: null,
        to: null,
        remark: "创建工单",
        at: "2026-07-09T02:00:00.000Z",
      },
    ],
  };
}

/** The table row containing the given 工单号. */
function rowFor(workOrderNumber: string) {
  const row = screen
    .getAllByRole("row")
    .find((candidate) => candidate.textContent?.includes(workOrderNumber));
  if (!row) throw new Error(`row not found: ${workOrderNumber}`);
  return row;
}

/** Page-level button probe; null when the entry is gated away. */
function button(name: string | RegExp) {
  return () => screen.queryByRole("button", { name });
}

/** Row-scoped button probe. */
function rowButton(workOrderNumber: string, name: string | RegExp) {
  return () => within(rowFor(workOrderNumber)).queryByRole("button", { name });
}

type GatingCase = {
  entry: string;
  /** 所需权限 (文档列 — 行内断言只认 role 的权限集) */
  permission: string;
  role: TestRole;
  visible: boolean;
  /** 可见但置灰 (终态行复选框) */
  disabled?: true;
  expectLabel: string;
  path: string;
  trpc?: TrpcOverrides;
  /** 页面就绪信号 — 缺权限的断言必须先等渲染落定 */
  ready: () => Promise<unknown>;
  query: () => HTMLElement | null;
};

type GatingSpec = Pick<
  GatingCase,
  "entry" | "permission" | "role" | "visible" | "disabled" | "query"
>;

function buildCase(spec: GatingSpec, surface: Pick<GatingCase, "path" | "trpc" | "ready">) {
  return {
    ...surface,
    ...spec,
    expectLabel: spec.visible ? (spec.disabled ? "置灰" : "可见") : "不可见",
  };
}

/** 列表页 (/tickets) 一行: 四状态行夹具, 等首行出现. */
function onList(spec: GatingSpec): GatingCase {
  return buildCase(spec, {
    path: "/tickets",
    trpc: {
      "ticket.list": { items: LIST_ITEMS, total: LIST_ITEMS.length, page: 1, pageSize: 20 },
    },
    ready: () => screen.findByText("WO100001"),
  });
}

/** 详情弹窗 (/tickets/t1) 一行: detail 夹具按状态生成, 等时间线出现. */
function onDetail(status: string, spec: GatingSpec): GatingCase {
  return buildCase(spec, {
    path: "/tickets/t1",
    trpc: { "ticket.detail": detailPayload(status) },
    ready: () => screen.findByText("处理记录"),
  });
}

const CASES: GatingCase[] = [
  // 导出 ← ticket.export
  onList({
    entry: "导出按钮",
    permission: "ticket.export",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    query: button(/导出/),
  }),
  onList({
    entry: "导出按钮",
    permission: "ticket.export",
    role: TEST_ROLES.READ_ONLY,
    visible: false,
    query: button(/导出/),
  }),

  // 导入 ← ticket.import (ticket.export 不构成充分条件)
  onList({
    entry: "导入按钮",
    permission: "ticket.import",
    role: IMPORTER,
    visible: true,
    query: button(/导入/),
  }),
  onList({
    entry: "导入按钮",
    permission: "ticket.import",
    role: TEST_ROLES.CS_MANAGER,
    visible: false,
    query: button(/导入/),
  }),

  // 行内分配/改派 ← ticket.assign, 终态行无操作
  onList({
    entry: "行内分配按钮",
    permission: "ticket.assign",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    query: rowButton("WO100001", "分配"),
  }),
  onList({
    entry: "行内改派按钮",
    permission: "ticket.assign",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    query: rowButton("WO100002", "改派"),
  }),
  onList({
    entry: "终态行操作按钮",
    permission: "ticket.assign",
    role: TEST_ROLES.CS_MANAGER,
    visible: false,
    query: rowButton("WO100004", /分配|改派/),
  }),
  onList({
    entry: "行内分配按钮",
    permission: "ticket.assign",
    role: TEST_ROLES.READ_ONLY,
    visible: false,
    query: rowButton("WO100001", "分配"),
  }),

  // 批量选择 ← ticket.batch_assign, 终态行复选框置灰
  onList({
    entry: "全选复选框",
    permission: "ticket.batch_assign",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    query: () => screen.queryByRole("checkbox", { name: "选择本页全部工单" }),
  }),
  onList({
    entry: "终态行复选框",
    permission: "ticket.batch_assign",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    disabled: true,
    query: () => screen.queryByRole("checkbox", { name: "选择工单 WO100004" }),
  }),
  onList({
    entry: "选择复选框列",
    permission: "ticket.batch_assign",
    role: TEST_ROLES.READ_ONLY,
    visible: false,
    query: () => screen.queryByRole("checkbox"),
  }),

  // 操作列 ← ticket.assign ‖ ticket.process 任一
  onList({
    entry: "操作列",
    permission: "ticket.assign | ticket.process",
    role: TEST_ROLES.FRONTLINE_CS,
    visible: true,
    query: () => screen.queryByText("操作"),
  }),
  onList({
    entry: "操作列",
    permission: "ticket.assign | ticket.process",
    role: ASSIGN_ONLY,
    visible: true,
    query: () => screen.queryByText("操作"),
  }),
  onList({
    entry: "操作列",
    permission: "ticket.assign | ticket.process",
    role: TEST_ROLES.READ_ONLY,
    visible: false,
    query: () => screen.queryByText("操作"),
  }),

  // 行内完结 ← ticket.process + in-flight 行
  onList({
    entry: "行内完结按钮",
    permission: "ticket.process",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    query: rowButton("WO100002", "完结"),
  }),
  onList({
    entry: "行内完结按钮",
    permission: "ticket.process",
    role: TEST_ROLES.CS_MANAGER,
    visible: true,
    query: rowButton("WO100003", "完结"),
  }),
  onList({
    entry: "行内完结按钮 (未分配行)",
    permission: "ticket.process",
    role: TEST_ROLES.CS_MANAGER,
    visible: false,
    query: rowButton("WO100001", "完结"),
  }),
  onList({
    entry: "行内完结按钮 (终态行)",
    permission: "ticket.process",
    role: TEST_ROLES.CS_MANAGER,
    visible: false,
    query: rowButton("WO100004", "完结"),
  }),
  onList({
    entry: "行内完结按钮",
    permission: "ticket.process",
    role: TEST_ROLES.FRONTLINE_CS,
    visible: true,
    query: rowButton("WO100002", "完结"),
  }),
  onList({
    entry: "行内完结按钮",
    permission: "ticket.process",
    role: ASSIGN_ONLY,
    visible: false,
    query: rowButton("WO100002", "完结"),
  }),
  onList({
    entry: "行内分配按钮",
    permission: "ticket.assign",
    role: ASSIGN_ONLY,
    visible: true,
    query: rowButton("WO100001", "分配"),
  }),
  onList({
    entry: "分配/改派/自动分配按钮",
    permission: "ticket.assign",
    role: TEST_ROLES.FRONTLINE_CS,
    visible: false,
    query: button(/分配|改派/),
  }),

  // 编辑 ← ticket.edit, 任意状态含已完结
  ...(["unassigned", "assigned", "processing", "completed"] as const).map((status) =>
    onDetail(status, {
      entry: "编辑按钮",
      permission: "ticket.edit",
      role: TEST_ROLES.CS_MANAGER,
      visible: true,
      query: button("编辑"),
    }),
  ),
  onDetail("processing", {
    entry: "编辑按钮",
    permission: "ticket.edit",
    role: TEST_ROLES.FRONTLINE_CS,
    visible: false,
    query: button("编辑"),
  }),

  // 删除 ← ticket.delete
  onDetail("processing", {
    entry: "删除按钮",
    permission: "ticket.delete",
    role: TEST_ROLES.ADMIN,
    visible: true,
    query: button("删除"),
  }),
  onDetail("processing", {
    entry: "删除按钮",
    permission: "ticket.delete",
    role: TEST_ROLES.CS_MANAGER,
    visible: false,
    query: button("删除"),
  }),

  // 完结工单 ← ticket.process + in-flight 单
  ...(["assigned", "processing"] as const).map((status) =>
    onDetail(status, {
      entry: "完结工单按钮",
      permission: "ticket.process",
      role: TEST_ROLES.FRONTLINE_CS,
      visible: true,
      query: button("完结工单"),
    }),
  ),
  onDetail("processing", {
    entry: "完结工单按钮",
    permission: "ticket.process",
    role: TEST_ROLES.READ_ONLY,
    visible: false,
    query: button("完结工单"),
  }),
  ...(["unassigned", "completed"] as const).map((status) =>
    onDetail(status, {
      entry: "完结工单按钮 (终态/未分配单)",
      permission: "ticket.process",
      role: TEST_ROLES.FRONTLINE_CS,
      visible: false,
      query: button("完结工单"),
    }),
  ),

  // 添加跟进卡片 ← ticket.process + in-flight 单
  onDetail("assigned", {
    entry: "添加跟进卡片",
    permission: "ticket.process",
    role: TEST_ROLES.FRONTLINE_CS,
    visible: true,
    query: () => screen.queryByLabelText("跟进备注"),
  }),
  onDetail("assigned", {
    entry: "提交跟进按钮",
    permission: "ticket.process",
    role: TEST_ROLES.FRONTLINE_CS,
    visible: true,
    query: button("提交跟进"),
  }),
  onDetail("assigned", {
    entry: "添加跟进卡片",
    permission: "ticket.process",
    role: TEST_ROLES.READ_ONLY,
    visible: false,
    query: () => screen.queryByLabelText("跟进备注"),
  }),
  ...(["unassigned", "completed"] as const).map((status) =>
    onDetail(status, {
      entry: "添加跟进卡片 (终态/未分配单)",
      permission: "ticket.process",
      role: TEST_ROLES.FRONTLINE_CS,
      visible: false,
      query: () => screen.queryByLabelText("跟进备注"),
    }),
  ),
];

describe("入口门控矩阵 (无权限 UI 无入口)", () => {
  it.each(CASES)("$entry [$permission] $role.name → $expectLabel", async (gating) => {
    renderApp({ path: gating.path, role: gating.role, trpc: gating.trpc });

    await gating.ready();

    const element = gating.query();
    if (gating.visible) {
      expect(element).toBeInTheDocument();
      if (gating.disabled) {
        expect(element).toBeDisabled();
      }
    } else {
      expect(element).not.toBeInTheDocument();
    }
  });
});
