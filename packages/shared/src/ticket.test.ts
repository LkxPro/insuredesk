import { describe, expect, it } from "vitest";
import {
  editComplaintInputSchema,
  editRefundInputSchema,
  ticketEditInputSchema,
} from "./ticket.ts";

const FULL_EDIT_PAYLOAD = {
  ticketId: "t1",
  feedbackTime: "2026-07-10T08:00:00.000Z",
  channelId: "ch1",
  project: "融盛",
  brokerageEntity: "凯森",
  paymentChannel: "连连",
  internalOrderNumber: "ORD-1",
  policyNumbers: ["P1"],
  noPolicyNumber: false,
  userFeedbackChannelId: "ufc1",
  feedbackReceiveChannelId: "frc1",
  customerName: "张三",
  phone: "13800000000",
  contactPhone: "13900000000",
  customerRequest: "诉求",
  nuclearBodyStatus: "是",
  hasContacted: true,
  contactTime: "2026-07-10T09:00:00.000Z",
  contactId: "c1",
  categoryId: "cat1",
  slaPolicyId: "sla1",
  priority: "high",
} as const;

const EDIT_REFUND_RETIRED_KEYS = [
  "brokerageEntity",
  "categoryId",
  "channelId",
  "complaintLevel",
  "contactId",
  "contactTime",
  "customerName",
  "customerRequest",
  "feedbackReceiveChannelId",
  "feedbackTime",
  "hasContacted",
  "internalOrderNumber",
  "noPolicyNumber",
  "nuclearBodyStatus",
  "paymentChannel",
  "phone",
  "policyNumbers",
  "priority",
  "project",
  "userFeedbackChannelId",
] as const;

const RETIRED_KEY_SAMPLE_VALUES: Record<(typeof EDIT_REFUND_RETIRED_KEYS)[number], unknown> = {
  brokerageEntity: "凯森",
  categoryId: "cat1",
  channelId: "ch1",
  complaintLevel: "一般",
  contactId: "c1",
  contactTime: "2026-07-10T09:00:00.000Z",
  customerName: "张三",
  customerRequest: "诉求",
  feedbackReceiveChannelId: "frc1",
  feedbackTime: "2026-07-10T08:00:00.000Z",
  hasContacted: false,
  internalOrderNumber: "ORD-1",
  noPolicyNumber: true,
  nuclearBodyStatus: "是",
  paymentChannel: "连连",
  phone: "13800000000",
  policyNumbers: ["P1"],
  priority: "high",
  project: "融盛",
  userFeedbackChannelId: "ufc1",
};

const COMPLAINT_EDIT_KEYS = [
  "brokerageEntity",
  "categoryId",
  "channelId",
  "complaintLevel",
  "contactId",
  "contactPhone",
  "contactTime",
  "customerName",
  "customerRequest",
  "feedbackReceiveChannelId",
  "feedbackTime",
  "hasContacted",
  "internalOrderNumber",
  "noPolicyNumber",
  "nuclearBodyStatus",
  "paymentChannel",
  "phone",
  "policyNumbers",
  "priority",
  "project",
  "slaPolicyId",
  "ticketId",
  "userFeedbackChannelId",
] as const;

describe("editComplaintInputSchema", () => {
  it("字段集＝现状编辑全集（23 键，含 complaintLevel 墓碑键）", () => {
    expect(Object.keys(editComplaintInputSchema.shape).sort()).toEqual([...COMPLAINT_EDIT_KEYS]);
    expect(Object.keys(ticketEditInputSchema.shape).sort()).toEqual([...COMPLAINT_EDIT_KEYS]);
  });

  it("全量载荷照常解析；complaintLevel 墓碑报错", () => {
    expect(editComplaintInputSchema.parse(FULL_EDIT_PAYLOAD)).toEqual(FULL_EDIT_PAYLOAD);
    const legacy = editComplaintInputSchema.safeParse({
      ticketId: "t1",
      complaintLevel: "加急投诉",
    });
    expect(legacy.success).toBe(false);
    if (!legacy.success) {
      expect(legacy.error.issues[0]?.message).toContain("投诉等级文本轨已下线");
    }
  });
});

describe("editRefundInputSchema", () => {
  it("仅裁留 ticketId/contactPhone/slaPolicyId：空编辑合法，三字段照常解析", () => {
    expect(editRefundInputSchema.parse({ ticketId: "t1" })).toEqual({
      ticketId: "t1",
      contactPhone: null,
      slaPolicyId: null,
      ...Object.fromEntries(EDIT_REFUND_RETIRED_KEYS.map((key) => [key, undefined])),
    });
    const data = editRefundInputSchema.parse({
      ticketId: "t1",
      contactPhone: " 13900000000 ",
      slaPolicyId: "sla1",
    });
    expect(data.contactPhone).toBe("13900000000");
    expect(data.slaPolicyId).toBe("sla1");
    expect(
      editRefundInputSchema.parse({ ticketId: "t1", contactPhone: "" }).contactPhone,
    ).toBeNull();
  });

  it("ticketId 仍是必填路由键", () => {
    expect(editRefundInputSchema.safeParse({}).success).toBe(false);
    expect(editRefundInputSchema.safeParse({ ticketId: "" }).success).toBe(false);
  });

  it("退役键全集＝投诉编辑全集裁掉三键，共 20 键", () => {
    const retired = Object.keys(ticketEditInputSchema.shape)
      .filter((key) => !["ticketId", "contactPhone", "slaPolicyId"].includes(key))
      .sort();
    expect(retired).toEqual([...EDIT_REFUND_RETIRED_KEYS]);
  });

  it("墓碑：退役键缺席放行，实际携带（含 null）即报错并引导刷新客户端", () => {
    for (const key of EDIT_REFUND_RETIRED_KEYS) {
      const carried = editRefundInputSchema.safeParse({
        ticketId: "t1",
        [key]: RETIRED_KEY_SAMPLE_VALUES[key],
      });
      expect(carried.success, `${key} 携带值必须报错`).toBe(false);
      if (!carried.success) {
        expect(carried.error.issues[0]?.message).toContain("请刷新客户端");
      }
      const nulled = editRefundInputSchema.safeParse({ ticketId: "t1", [key]: null });
      expect(nulled.success, `${key} 携带 null 必须报错`).toBe(false);
      if (!nulled.success) {
        expect(nulled.error.issues[0]?.message).toContain("请刷新客户端");
      }
    }
  });

  it("strict：退役键之外的任何未知键同样拒绝（status/补偿金/导入专属列）", () => {
    for (const key of [
      "status",
      "compensationAmount",
      "completionStatusId",
      "completionRemark",
      "kindId",
    ]) {
      expect(editRefundInputSchema.safeParse({ ticketId: "t1", [key]: "x" }).success).toBe(false);
    }
  });
});
