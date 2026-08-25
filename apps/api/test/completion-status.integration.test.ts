import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateInput,
} from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import type { AuthenticatedUser } from "../src/services/auth.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("CompletionStatus catalog smoke (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let seeded: IntegrationHarness["seeded"];
  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    seeded = harness.seeded;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function callerWith(user: User, permissions: Permission[]) {
    const identity: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: "role-under-test",
      roleName: "目录管理员",
      permissions,
      requiredTicketFields: [],
      isExternal: false,
    };
    return appRouter.createCaller({
      traceId: "completion-status-smoke",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () =>
    callerWith(seeded.users.manager, [
      "dictionary.manage",
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.assign",
      "ticket.process",
      "ticket.delete",
      "ticket.export",
    ] as Permission[]);

  async function createResolvableTicket() {
    const created = await manager().ticket.create(blankTicketInput());
    await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.manager.id });
    return created.id;
  }

  it("the migration populates the 12 historical values in enum order — no app-layer seed", async () => {
    const statuses = await manager().completionStatus.list();
    expect(statuses.map((status) => status.name)).toEqual([
      "未取得有效联系",
      "已达成一致",
      "诉求过高，无法达成一致",
      "客户自行撤诉",
      "已协商解决",
      "已赔付",
      "已退保",
      "转其他部门处理",
      "无效工单",
      "正常完结",
      "冷处理",
      "联系不上",
    ]);
    expect(statuses.every((status) => status.active)).toBe(true);
  });

  it("creates a new status", async () => {
    const created = await manager().completionStatus.create({
      name: "测试新增状态",
      displayOrder: 90,
    });
    expect(created).toMatchObject({ name: "测试新增状态", displayOrder: 90, active: true });
  });

  it("renames a status", async () => {
    const created = await manager().completionStatus.create({
      name: "待重命名状态",
      displayOrder: 100,
    });
    const updated = await manager().completionStatus.update({
      id: created.id,
      name: "已重命名状态",
      displayOrder: 100,
    });
    expect(updated.name).toBe("已重命名状态");
  });

  it("disables a status", async () => {
    const created = await manager().completionStatus.create({
      name: "待停用状态",
      displayOrder: 110,
    });
    await manager().completionStatus.setActive({ id: created.id, active: false });
    const statuses = await manager().completionStatus.list();
    const disabled = statuses.find((s) => s.id === created.id);
    expect(disabled?.active).toBe(false);
  });

  it("rejects deletion of a referenced status", async () => {
    const status = await manager().completionStatus.create({
      name: "被引用状态",
      displayOrder: 120,
    });
    const ticketId = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "完结测试",
    });

    await expect(manager().completionStatus.delete({ id: status.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该完结状态已被 1 张工单使用，无法删除，可改为停用",
    });
  });

  it("引用必填：resolving requires an existing, active status", async () => {
    const status = await manager().completionStatus.create({
      name: "完结用",
      displayOrder: 230,
    });

    const ticketId = await createResolvableTicket();
    await expect(
      manager().ticket.resolve({
        ticketId,
        completionStatusId: "no-such-id",
        remark: "引用不存在的状态",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选完结状态不存在" });

    const disabled = await manager().completionStatus.create({
      name: "停用中",
      displayOrder: 231,
    });
    await manager().completionStatus.setActive({ id: disabled.id, active: false });
    await expect(
      manager().ticket.resolve({
        ticketId,
        completionStatusId: disabled.id,
        remark: "引用停用的状态",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选完结状态已停用" });

    const result = await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "正常完结这一单",
    });
    expect(result).toMatchObject({ status: "completed", completionStatus: "完结用" });
  });

  it("无保留停用值的编辑路径：completion status is assigned at resolve, not create/edit", async () => {
    const status = await manager().completionStatus.create({
      name: "完结后不可编辑",
      displayOrder: 240,
    });
    const ticketId = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "完结",
    });

    const detail = await manager().ticket.detail({ id: ticketId });
    expect(detail.status).toBe("completed");
    expect(detail.completionStatus).toBe("完结后不可编辑");
  });

  it("目录行来自迁移：migration seeds 12 values, no app-layer seedCompletionStatuses", async () => {
    const statuses = await manager().completionStatus.list();
    expect(statuses.length).toBeGreaterThanOrEqual(12);
    expect(statuses.map((s) => s.name)).toContain("未取得有效联系");
    expect(statuses.map((s) => s.name)).toContain("正常完结");
  });

  function blankTicketInput() {
    return Object.fromEntries(
      TICKET_CREATE_FIELD_KEYS.map((key) => [key, null]),
    ) as TicketCreateInput;
  }
});
