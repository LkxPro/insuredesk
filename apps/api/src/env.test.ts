import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";

const minimal = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=public",
  SESSION_SECRET: "test-secret-at-least-32-characters-long-for-security",
};

describe("parseEnv", () => {
  it("applies defaults when only the required vars are present", () => {
    const env = parseEnv(minimal);

    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.SESSION_MAX_AGE_SECONDS).toBe(86400);
  });

  it("crashes when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ SESSION_SECRET: minimal.SESSION_SECRET })).toThrow(/DATABASE_URL/);
  });

  it("crashes when SESSION_SECRET is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: minimal.DATABASE_URL })).toThrow(/SESSION_SECRET/);
  });

  it("rejects SESSION_SECRET that is too short", () => {
    expect(() => parseEnv({ ...minimal, SESSION_SECRET: "too-short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() => parseEnv({ ...minimal, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("coerces PORT from a string", () => {
    expect(parseEnv({ ...minimal, PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ ...minimal, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
