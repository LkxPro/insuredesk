import { describe, it, expect } from "vitest";
import {
  filterVisibleFields,
  SENSITIVE_TICKET_FIELDS,
  EXTERNAL_VISIBLE_FIELD_OPTIONS,
  DEFAULT_EXTERNAL_VISIBLE_FIELDS,
} from "@insuredesk/shared";

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
        project: "融盛",
      };

      const result = filterVisibleFields(ticket, ["workOrderNumber"]);

      expect(result.workOrderNumber).toBe("WO100001");
      expect(result.customerName).toBeNull();
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

    it("forcibly filters sensitive fields even if whitelisted", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        phone: "13800138000",
        contactPhone: "13900139000",
        customerName: "张三",
        policyNumbers: ["POL123"],
        internalOrderNumber: "ORD999",
        contactId: "CONTACT001",
      };

      // Attempt to whitelist all fields including sensitive ones
      const result = filterVisibleFields(ticket, [
        "workOrderNumber",
        "phone",
        "contactPhone",
        "customerName",
        "policyNumbers",
        "internalOrderNumber",
        "contactId",
      ]);

      expect(result.workOrderNumber).toBe("WO100001");
      // All sensitive fields should be null or []
      expect(result.phone).toBeNull();
      expect(result.contactPhone).toBeNull();
      expect(result.customerName).toBeNull();
      expect(result.policyNumbers).toEqual([]);
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

    it("handles empty whitelist by filtering everything except preserving types", () => {
      const ticket = {
        workOrderNumber: "WO100001",
        status: "unassigned",
        policyNumbers: ["POL123"],
      };

      const result = filterVisibleFields(ticket, []);

      expect(result.workOrderNumber).toBeNull();
      expect(result.status).toBeNull();
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
      // customerName and phone are sensitive, originally undefined → stay undefined
      expect(result.customerName).toBeUndefined();
      expect(result.phone).toBeUndefined();
      // project is not whitelisted, has value → null
      expect(result.project).toBeNull();
      // policyNumbers is sensitive array → []
      expect(result.policyNumbers).toEqual([]);
    });
  });

  describe("constants", () => {
    it("SENSITIVE_TICKET_FIELDS includes expected sensitive fields", () => {
      expect(SENSITIVE_TICKET_FIELDS).toContain("phone");
      expect(SENSITIVE_TICKET_FIELDS).toContain("contactPhone");
      expect(SENSITIVE_TICKET_FIELDS).toContain("policyNumbers");
      expect(SENSITIVE_TICKET_FIELDS).toContain("internalOrderNumber");
      expect(SENSITIVE_TICKET_FIELDS).toContain("customerName");
      expect(SENSITIVE_TICKET_FIELDS).toContain("contactId");
    });

    it("EXTERNAL_VISIBLE_FIELD_OPTIONS excludes sensitive fields", () => {
      for (const sensitiveField of SENSITIVE_TICKET_FIELDS) {
        expect(EXTERNAL_VISIBLE_FIELD_OPTIONS).not.toContain(sensitiveField);
      }
    });

    it("EXTERNAL_VISIBLE_FIELD_OPTIONS excludes import-only fields", () => {
      expect(EXTERNAL_VISIBLE_FIELD_OPTIONS).not.toContain("completionRemark");
    });

    it("DEFAULT_EXTERNAL_VISIBLE_FIELDS contains safe, useful fields", () => {
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("workOrderNumber");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("feedbackTime");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("status");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("completionStatusId");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("processingResult");
    });

    it("DEFAULT_EXTERNAL_VISIBLE_FIELDS contains no sensitive fields", () => {
      for (const sensitiveField of SENSITIVE_TICKET_FIELDS) {
        expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).not.toContain(sensitiveField);
      }
    });
  });
});
