import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Testcontainers has to pull/boot a real Postgres image on first run.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
