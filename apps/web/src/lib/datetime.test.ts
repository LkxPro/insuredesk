import { describe, expect, it } from "vitest";
import { formatDateTime } from "./datetime";

describe("formatDateTime", () => {
  it("displays ticket timestamps with a 24-hour clock and no AM/PM marker", () => {
    const displayed = formatDateTime("2026-07-09T23:05:00");

    expect(displayed).toBe("2026-07-09 23:05");
    expect(displayed).not.toMatch(/AM|PM/i);
  });
});
