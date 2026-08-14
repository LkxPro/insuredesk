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
    // No strictPort: a colliding worktree auto-increments to a free port.
    port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : 5173,
    // Default host 'localhost' resolves to ::1 first on macOS (Node 17+ uses
    // verbatim DNS order), so vite would bind IPv6 loopback only and direct
    // 127.0.0.1 access gets refused. Pin IPv4 loopback.
    host: "127.0.0.1",
    // Proxy API calls to the api in dev so the browser talks same-origin
    // (no CORS dance). /trpc carries queries; /api carries the login/logout
    // REST endpoints (cookie handling).
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
