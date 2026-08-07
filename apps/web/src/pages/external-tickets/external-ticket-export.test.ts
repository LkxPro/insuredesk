import { describe, expect, it } from "vitest";
import { buildExternalTicketExportUrl } from "./external-ticket-export";

describe("external ticket export URL", () => {
  it("carries the current filters and sorting while dropping pagination", () => {
    expect(
      buildExternalTicketExportUrl(
        {
          status: ["processing", "completed"],
          completionStatusId: ["resolved", "withdrawn"],
          search: "张三",
          feedbackFrom: "2026-08-01T00:00:00.000+08:00",
          feedbackTo: "2026-08-07T23:59:59.999+08:00",
          sortBy: "status",
          sortOrder: "asc",
        },
        "csv",
        "Asia/Shanghai",
      ),
    ).toBe(
      "/api/external-tickets/export?format=csv&sortBy=status&sortOrder=asc&timeZone=Asia%2FShanghai&status=processing%2Ccompleted&completionStatusId=resolved%2Cwithdrawn&search=%E5%BC%A0%E4%B8%89&feedbackFrom=2026-08-01T00%3A00%3A00.000%2B08%3A00&feedbackTo=2026-08-07T23%3A59%3A59.999%2B08%3A00",
    );
  });
});
