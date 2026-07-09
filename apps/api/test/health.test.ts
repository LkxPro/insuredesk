import { healthStatusSchema } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { appRouter } from "../src/routers";

describe("health procedure", () => {
  it("returns an ok status conforming to the shared contract", async () => {
    const caller = appRouter.createCaller({ traceId: "test", user: null, sessionToken: null });

    const result = await caller.health();

    // The shared Zod schema is the independent source of truth for the shape;
    // parsing fails if the handler and the contract ever drift apart.
    expect(() => healthStatusSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("insuredesk-api");
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
