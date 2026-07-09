import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const minimal = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public" };

describe("parseEnv", () => {
  it("applies defaults when only the required vars are present", () => {
    const env = parseEnv(minimal);

    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("crashes when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("coerces PORT from a string", () => {
    expect(parseEnv({ ...minimal, PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ ...minimal, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
