export type DetailPayload = ReturnType<typeof detailPayload>;

export function detailPayload(overrides: Record<string, unknown> = {}) {
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
    userFeedbackChannel: { id: "ufc-hotline", name: "保司400热线", active: true },
    feedbackReceiveChannel: {
      id: "frc-group",
      name: "（微信）凯森&骏伯反馈对接群",
      active: true,
    },
    customerName: "王小明",
    phone: "13800000001",
    contactPhone: null,
    customerRequest: "对理赔进度有异议",
    submissionText: null,
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    contactTime: null,
    contactId: null,
    category: { id: "cat-claims", name: "理赔投诉", active: true },
    slaPolicyId: "pol-normal",
    slaPolicy: { id: "pol-normal", name: "一般投诉", active: true },
    kindKey: "complaint",
    priority: null,
    followUpFrequency: "24小时内累计跟进1次",
    firstResponseRequirement: "120分钟内完成首次响应",
    status: "processing",
    displayStatus: "processing",
    assigneeId: "u1",
    assigneeName: "测试用户",
    assignedAt: "2026-07-09T03:00:00.000Z",
    dueAt: "2026-07-11T02:00:00.000Z",
    nextContactTime: null,
    contactCount: 1,
    completionTime: null,
    completionStatus: null,
    processLogs: [
      {
        id: "log-1",
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
    refundDetail: null,
    callbackDelivery: null,
    ...overrides,
  };
}

export function refundDetailPayload(overrides: Record<string, unknown> = {}) {
  return {
    sysOrderId: "SO-20260818",
    endorNo: "ENDOR-20260818-NO1",
    workOrderType: "卡异常-退费失败",
    expectedAmount: "100.00",
    refundCreateTime: "2026-08-18T08:40:00.000Z",
    refundTrades: [
      { tradeNo: "1", payNo: "PAY20260818001", expectedAmount: "60.00" },
      { tradeNo: "2", payNo: "PAY20260818002", expectedAmount: "40.00" },
    ],
    holderName: "张三",
    holderPhone: "13800000001",
    companyName: "泰康在线",
    productId: "P10001",
    productName: "泰康百万医疗险",
    policyNo: "P20260818000123",
    failureReason: "银行卡状态异常，退款被退回",
    pushedFields: [
      "sysOrderId",
      "endorNo",
      "workOrderType",
      "expectedAmount",
      "refundCreateTime",
      "refundTrade",
      "holderName",
      "holderPhone",
      "companyName",
      "productId",
      "productName",
      "policyNo",
      "failureReason",
    ],
    compensationAmount: null,
    ...overrides,
  };
}

export function callbackDeliveryPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    status: "pending",
    attempts: 0,
    lastError: null,
    deliveredAt: null,
    ...overrides,
  };
}

export function listItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    workOrderNumber: "WO100001",
    createdAt: "2026-07-09T02:00:00.000Z",
    source: "manual",
    channel: "保司",
    category: "理赔投诉",
    slaPolicyId: "pol-normal",
    slaPolicyName: "一般投诉",
    customerName: "王小明",
    policyNumbers: ["P2026070900123"],
    status: "processing",
    displayStatus: "processing",
    assigneeId: "u1",
    assigneeName: "测试用户",
    dueAt: "2026-07-11T02:00:00.000Z",
    ...overrides,
  };
}

/** 编辑态下拉的选项 feed：只列启用项，与服务端 options 同口径。 */
export const channelOptions = [
  { id: "ch-baosi", name: "保司", active: true },
  { id: "ch-pay", name: "支付渠道", active: true },
];

export const categoryOptions = [
  { id: "cat-claims", name: "理赔投诉", active: true },
  { id: "cat-service", name: "服务投诉", active: true },
];

export const completionStatusOptions = [
  { id: "cs-normal", name: "正常完结" },
  { id: "cs-negotiated", name: "已协商解决" },
];

/** sla.options 的选项 feed：仅启用策略（id/name/description，按目录序）。 */
export const slaPolicyOptions = [
  { id: "pol-normal", name: "一般投诉", description: "常规投诉：48 小时处理时限。" },
  { id: "pol-urgent", name: "特急投诉", description: "特急投诉：不设处理时限，滚动跟进。" },
];
