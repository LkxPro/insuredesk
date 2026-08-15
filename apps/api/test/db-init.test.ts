import { describe, expect, it } from "vitest";

/**
 * db.ts is imported transitively by server.ts, so it must be importable before
 * env loading is settled — but any actual use without DATABASE_URL has to fail
 * with a pointed error, not pg's libpq-defaults SASL failure. Runs in its own
 * file so the module registry and process.env are isolated from other tests.
 */
describe("lazy Prisma client initialization", () => {
  it("imports fine without DATABASE_URL but fails loudly on first use", async () => {
    delete process.env.DATABASE_URL;
    const { prisma } = await import("../src/db.ts");
    expect(() => prisma.user).toThrowError(/DATABASE_URL/);
  });

  it("initializes on first use once DATABASE_URL is present", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db?schema=public";
    const { prisma } = await import("../src/db.ts");
    expect(prisma.user).toBeDefined();
    expect(typeof prisma.$disconnect).toBe("function");
  });
});
