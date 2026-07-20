import { ticketCreateInputSchema, ticketEditInputSchema } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";

/**
 * Issue #43 contract tests: every user-entered field of the shared ticket
 * create/edit schemas is optional, and every unfilled representation the form
 * can produce (absent, null, "", whitespace) normalizes to null — "unknown",
 * never "" or an assumed value.
 */
describe("ticketCreateInputSchema (issue #43 all-optional)", () => {
  it("accepts a completely empty object and yields all-null data", () => {
    const data = ticketCreateInputSchema.parse({});
    expect(data).toEqual({
      feedbackTime: null,
      channelId: null,
      project: null,
      brokerageEntity: null,
      paymentChannel: null,
      internalOrderNumber: null,
      policyNumber: null,
      userComplaintChannel: null,
      complaintReceiveChannel: null,
      customerName: null,
      phone: null,
      contactPhone: null,
      customerRequest: null,
      nuclearBodyStatus: null,
      hasContacted: null,
      contactTime: null,
      contactId: null,
      categoryId: null,
      complaintLevel: null,
      priority: null,
    });
  });

  it('normalizes "" and whitespace to null across text, enum and datetime fields', () => {
    const data = ticketCreateInputSchema.parse({
      feedbackTime: "",
      channelId: "",
      project: "   ",
      customerName: "",
      nuclearBodyStatus: "",
      categoryId: "",
      complaintLevel: "",
      priority: "",
    });
    expect(data.feedbackTime).toBeNull();
    expect(data.channelId).toBeNull();
    expect(data.project).toBeNull();
    expect(data.customerName).toBeNull();
    expect(data.nuclearBodyStatus).toBeNull();
    expect(data.categoryId).toBeNull();
    expect(data.complaintLevel).toBeNull();
    expect(data.priority).toBeNull();
  });

  it("hasContacted is tri-state: true/false pass through, absent means unknown", () => {
    expect(ticketCreateInputSchema.parse({ hasContacted: true }).hasContacted).toBe(true);
    expect(ticketCreateInputSchema.parse({ hasContacted: false }).hasContacted).toBe(false);
    expect(ticketCreateInputSchema.parse({}).hasContacted).toBeNull();
    expect(ticketCreateInputSchema.parse({ hasContacted: null }).hasContacted).toBeNull();
  });

  it("still validates filled values: bad enum members and malformed datetimes reject", () => {
    expect(ticketCreateInputSchema.safeParse({ complaintLevel: "特大投诉" }).success).toBe(false);
    expect(ticketCreateInputSchema.safeParse({ feedbackTime: "not-a-date" }).success).toBe(false);
    expect(
      ticketCreateInputSchema.safeParse({ feedbackTime: "2026-07-10T08:00:00.000Z" }).success,
    ).toBe(true);
  });

  it("edit shares the same optionality plus the ticketId routing key", () => {
    expect(ticketEditInputSchema.safeParse({ ticketId: "t1" }).success).toBe(true);
    expect(ticketEditInputSchema.safeParse({}).success).toBe(false);
    const data = ticketEditInputSchema.parse({ ticketId: "t1", customerName: " 张三 " });
    expect(data.customerName).toBe("张三");
    expect(data.channelId).toBeNull();
  });
});
