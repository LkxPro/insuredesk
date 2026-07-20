import {
  TICKET_COMPLETION_REMARK_LIMIT,
  TICKET_CREATE_FIELD_KEYS,
  TICKET_FIELD_DESCRIPTORS,
  TICKET_FIELDS,
  TICKET_IMPORT_HEADERS,
  TICKET_TEXT_LIMITS,
  ticketExportHeader,
  ticketProcessLogLabel,
} from "@insuredesk/shared";
import { describe, expect, it } from "vitest";

/**
 * 字段描述表的派生面 golden：key 清单、长度上限、导入表头，以及各 override
 * 槽位登记的既有表面用词。override 值是既成契约（导出列头下游按名取数、
 * 留痕短名已写入历史日志），改动必须显式过这里。
 */

describe("ticket field descriptors", () => {
  it("建单字段 key 清单派生自描述表（表单呈现顺序，不含导入专属列）", () => {
    expect(TICKET_CREATE_FIELD_KEYS).toEqual([
      "feedbackTime",
      "channelId",
      "project",
      "brokerageEntity",
      "paymentChannel",
      "internalOrderNumber",
      "policyNumber",
      "userComplaintChannel",
      "complaintReceiveChannel",
      "customerName",
      "phone",
      "contactPhone",
      "nuclearBodyStatus",
      "customerRequest",
      "hasContacted",
      "contactTime",
      "contactId",
      "categoryId",
      "complaintLevel",
      "priority",
    ]);
  });

  it("完结状态/完结备注是仅有的导入专属列，收在表尾", () => {
    expect(TICKET_FIELD_DESCRIPTORS.length).toBe(22);
    expect(TICKET_IMPORT_HEADERS.length).toBe(22);
    const importOnly = TICKET_FIELD_DESCRIPTORS.filter(
      (descriptor) => "importOnly" in descriptor && descriptor.importOnly,
    );
    expect(importOnly.map((descriptor) => descriptor.key)).toEqual([
      "completionStatusId",
      "completionRemark",
    ]);
    expect(TICKET_IMPORT_HEADERS.slice(-2)).toEqual(["完结状态", "完结备注"]);
  });

  it("文本长度上限 golden（渠道/类别引用上限一并收编）", () => {
    expect(TICKET_TEXT_LIMITS).toEqual({
      project: 100,
      brokerageEntity: 100,
      paymentChannel: 100,
      internalOrderNumber: 200,
      policyNumber: 100,
      userComplaintChannel: 100,
      complaintReceiveChannel: 100,
      customerName: 100,
      phone: 50,
      contactPhone: 200,
      customerRequest: 2000,
      contactId: 200,
    });
    expect(TICKET_COMPLETION_REMARK_LIMIT).toBe(2000);
    expect(TICKET_FIELDS.channelId.maxLength).toBe(100);
    expect(TICKET_FIELDS.categoryId.maxLength).toBe(100);
  });

  it("导出列头 override 登记＝现行导出用词（与标准名不同的字段才登记）", () => {
    const exportOverrides = Object.fromEntries(
      TICKET_FIELD_DESCRIPTORS.flatMap((descriptor) =>
        "overrides" in descriptor && descriptor.overrides.exportHeader
          ? [[descriptor.key, descriptor.overrides.exportHeader]]
          : [],
      ),
    );
    expect(exportOverrides).toEqual({
      channelId: "渠道",
      project: "项目",
      phone: "客户电话",
      contactPhone: "联系电话",
      nuclearBodyStatus: "核体状态",
      hasContacted: "是否已联系",
      contactId: "联系ID",
      categoryId: "分类",
    });
  });

  it("表面用词派生：登记了 override 槽位用登记值，缺省回落标准名", () => {
    expect(ticketExportHeader("channelId")).toBe("渠道");
    expect(ticketExportHeader("customerName")).toBe("客户姓名");
    expect(ticketProcessLogLabel("phone")).toBe("客户电话");
    expect(ticketProcessLogLabel("channelId")).toBe("反馈渠道");
  });

  it("语境变体 override：留痕短名与详情页解释后缀", () => {
    expect(TICKET_FIELDS.phone.overrides.processLogLabel).toBe("客户电话");
    expect(TICKET_FIELDS.contactPhone.overrides.detailLabel).toBe("联系人电话（备用）");
    expect(TICKET_FIELDS.phone.label).toBe("客户电话（投保人）");
    expect(TICKET_FIELDS.contactPhone.label).toBe("联系人电话");
  });
});
