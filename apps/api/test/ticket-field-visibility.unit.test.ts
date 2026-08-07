import {
  ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS,
  DEFAULT_EXTERNAL_DETAIL_FIELDS,
  DEFAULT_EXTERNAL_LIST_FIELDS,
  DEFAULT_EXTERNAL_VISIBLE_FIELDS,
  EXTERNAL_RESTRICTED_TICKET_FIELDS,
  EXTERNAL_VISIBLE_FIELD_OPTIONS,
  filterVisibleFields,
  resolveExternalFieldOrder,
  resolveExternalVisibleFields,
} from "@insuredesk/shared";
import { describe, expect, it } from "vitest";

describe("ticket-field-visibility", () => {
  describe("filterVisibleFields", () => {
    it("preserves whitelisted fields", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        feedbackTime: "2026-07-27T10:00:00Z",
        status: "unassigned",
        customerName: "张三",
        phone: "13800138000",
      };

      const result = filterVisibleFields(ticket, ["workOrderNumber", "feedbackTime", "status"]);

      expect(result.workOrderNumber).toBe("WO100001");
      expect(result.feedbackTime).toBe("2026-07-27T10:00:00Z");
      expect(result.status).toBe("unassigned");
    });

    it("filters out non-whitelisted fields to null", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        customerName: "张三",
        submissionText: "原始反馈",
        project: "融盛",
      };

      const result = filterVisibleFields(ticket, ["workOrderNumber"]);

      expect(result.workOrderNumber).toBe("WO100001");
      expect(result.customerName).toBeNull();
      expect(result.submissionText).toBeNull();
      expect(result.project).toBeNull();
    });

    it("filters out non-whitelisted array fields to empty array", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        policyNumbers: ["POL123", "POL456"],
        tags: ["urgent"],
      };

      const result = filterVisibleFields(ticket, ["workOrderNumber"]);

      expect(result.workOrderNumber).toBe("WO100001");
      expect(result.policyNumbers).toEqual([]);
      expect(result.tags).toEqual([]);
    });

    it("allows account-authorized sensitive fields but always filters internal fields", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        submissionText: "原始反馈",
        phone: "13800138000",
        contactPhone: "13900139000",
        customerName: "张三",
        policyNumbers: ["POL123"],
        internalOrderNumber: "ORD999",
        contactId: "CONTACT001",
      };

      // Attempt to whitelist all fields, including the permanently restricted ones.
      const result = filterVisibleFields(ticket, [
        "workOrderNumber",
        "submissionText",
        "phone",
        "contactPhone",
        "customerName",
        "policyNumbers",
        "internalOrderNumber",
        "contactId",
      ]);

      expect(result.workOrderNumber).toBe("WO100001");
      expect(result.submissionText).toBe("原始反馈");
      expect(result.phone).toBe("13800138000");
      expect(result.customerName).toBe("张三");
      expect(result.policyNumbers).toEqual(["POL123"]);
      expect(result.contactPhone).toBeNull();
      expect(result.internalOrderNumber).toBeNull();
      expect(result.contactId).toBeNull();
    });

    it("returns new object without mutating input", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        customerName: "张三",
      };

      const result = filterVisibleFields(ticket, ["workOrderNumber"]);

      expect(result).not.toBe(ticket);
      expect(ticket.customerName).toBe("张三"); // Original unchanged
      expect(result.customerName).toBeNull();
    });

    it("handles empty whitelist by filtering everything except system fields", () => {
      const ticket = {
        id: "ticket-123",
        workOrderNumber: "WO100001",
        status: "unassigned",
        createdAt: new Date("2024-01-01"),
        policyNumbers: ["POL123"],
      };

      const result = filterVisibleFields(ticket, []);

      // Technical identity fields are preserved; status and business fields remain configurable.
      expect(result.id).toBe("ticket-123");
      expect(result.createdAt).toEqual(new Date("2024-01-01"));
      expect(result.status).toBeNull();
      // Non-system fields filtered
      expect(result.workOrderNumber).toBeNull();
      expect(result.policyNumbers).toEqual([]);
    });

    it("preserves undefined for fields that were undefined in input", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        customerName: undefined,
        phone: undefined,
        project: "融盛",
        policyNumbers: ["POL123"],
      };

      const result = filterVisibleFields(ticket, ["workOrderNumber"]);

      expect(result.workOrderNumber).toBe("WO100001");
      // Account-authorizable sensitive fields still preserve an original undefined.
      expect(result.customerName).toBeUndefined();
      expect(result.phone).toBeUndefined();
      // project is not whitelisted, has value → null
      expect(result.project).toBeNull();
      // policyNumbers is not whitelisted → []
      expect(result.policyNumbers).toEqual([]);
    });
  });

  describe("constants", () => {
    it("separates account-authorizable sensitive fields from permanently restricted fields", () => {
      expect(ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS).toEqual([
        "customerName",
        "policyNumbers",
        "phone",
      ]);
      expect(EXTERNAL_RESTRICTED_TICKET_FIELDS).toEqual([
        "contactPhone",
        "internalOrderNumber",
        "contactId",
      ]);
    });

    it("EXTERNAL_VISIBLE_FIELD_OPTIONS excludes permanently restricted fields", () => {
      for (const restrictedField of EXTERNAL_RESTRICTED_TICKET_FIELDS) {
        expect(EXTERNAL_VISIBLE_FIELD_OPTIONS).not.toContain(restrictedField);
      }
    });

    it("EXTERNAL_VISIBLE_FIELD_OPTIONS excludes import-only fields", () => {
      expect(EXTERNAL_VISIBLE_FIELD_OPTIONS).not.toContain("completionRemark");
    });

    it("external field options include account-authorized customer identity fields", () => {
      expect(EXTERNAL_VISIBLE_FIELD_OPTIONS).toEqual(
        expect.arrayContaining(["customerName", "policyNumbers", "phone"]),
      );
      expect(EXTERNAL_RESTRICTED_TICKET_FIELDS).toEqual(
        expect.arrayContaining(["contactPhone", "internalOrderNumber", "contactId"]),
      );
      for (const field of EXTERNAL_RESTRICTED_TICKET_FIELDS) {
        expect(EXTERNAL_VISIBLE_FIELD_OPTIONS).not.toContain(field);
      }
    });

    it("uses separate safe defaults for list and detail/search/export surfaces", () => {
      expect(DEFAULT_EXTERNAL_LIST_FIELDS).toEqual([
        "feedbackTime",
        "policyNumbers",
        "customerName",
        "status",
        "processingResult",
        "completionStatusId",
      ]);
      expect(DEFAULT_EXTERNAL_DETAIL_FIELDS).toEqual([
        "workOrderNumber",
        "feedbackTime",
        "status",
        "completionStatusId",
        "processingResult",
      ]);
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toEqual(DEFAULT_EXTERNAL_DETAIL_FIELDS);
    });

    it("resolves null and empty selections to the requested surface default", () => {
      expect(resolveExternalVisibleFields(null, DEFAULT_EXTERNAL_LIST_FIELDS)).toEqual(
        DEFAULT_EXTERNAL_LIST_FIELDS,
      );
      expect(resolveExternalVisibleFields("[]", DEFAULT_EXTERNAL_DETAIL_FIELDS)).toEqual(
        DEFAULT_EXTERNAL_DETAIL_FIELDS,
      );
    });

    it("keeps configured order while dropping unknown and permanently restricted fields", () => {
      expect(
        resolveExternalVisibleFields(
          JSON.stringify(["customerName", "contactPhone", "feedbackTime", "customerName"]),
          DEFAULT_EXTERNAL_LIST_FIELDS,
        ),
      ).toEqual(["customerName", "feedbackTime"]);
    });

    it("reconciles personal order with current authorization and appends newly granted fields", () => {
      expect(
        resolveExternalFieldOrder(JSON.stringify(["status", "revoked", "feedbackTime"]), [
          "feedbackTime",
          "customerName",
          "status",
        ]),
      ).toEqual(["status", "feedbackTime", "customerName"]);
      expect(resolveExternalFieldOrder(null, ["feedbackTime", "status"])).toEqual([
        "feedbackTime",
        "status",
      ]);
    });

    it("DEFAULT_EXTERNAL_VISIBLE_FIELDS contains safe, useful fields", () => {
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("workOrderNumber");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("feedbackTime");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("status");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("completionStatusId");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("processingResult");
    });

    it("default detail/search/export fields contain no account-authorized sensitive fields", () => {
      for (const sensitiveField of ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS) {
        expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).not.toContain(sensitiveField);
      }
    });
  });
});
