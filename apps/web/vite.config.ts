import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/…` → src/…, the alias shadcn/kibo-ui components expect.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Fork-per-core saturates the machine and flakes async-heavy suites, so
    // cap the workers. testTimeout is unrelated to that cap but must stay
    // above setup.ts's asyncUtilTimeout, or it fires before waitFor/findBy
    // gets its full polling window.
    maxWorkers: 4,
    testTimeout: 15000,
  },
  server: {
    port: 5173,
    // Proxy API calls to the api in dev so the browser talks same-origin
    // (no CORS dance). /trpc carries queries; /api carries the login/logout
    // REST endpoints (cookie handling). Parallel worktrees override
    // VITE_API_URL with their own hash-assigned api port (scripts/dev-up.sh).
    proxy: {
      "/trpc": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
