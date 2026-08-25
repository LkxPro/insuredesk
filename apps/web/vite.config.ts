import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createLogger } from "vite";
import { defineConfig } from "vitest/config";

// api 未起时,浏览器每次刷新都会触发 /trpc、/api 代理的 ECONNREFUSED,vite
// 默认打整段堆栈。这两条 proxy 唯一的可预期失败就是 api 不在,静默之;其他
// 错误照常打印。
const logger = createLogger();
const loggerError = logger.error;
logger.error = (msg, options) => {
  const code = (options?.error as NodeJS.ErrnoException | null)?.code;
  if (code === "ECONNREFUSED" && msg.includes("proxy error")) return;
  loggerError(msg, options);
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  customLogger: logger,
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
    // 端口由 dev-ports.sh 按 worktree 分配并避让,撞车必须报错——静默自增会和
    // dev-up.sh 的就绪轮询、make open 的端口推导错位。
    strictPort: true,
    port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : 5173,
    // Default host 'localhost' resolves to ::1 first on macOS (Node 17+ uses
    // verbatim DNS order), so vite would bind IPv6 loopback only and direct
    // 127.0.0.1 access gets refused. Pin IPv4 loopback.
    host: "127.0.0.1",
    // Proxy API calls to the api in dev so the browser talks same-origin
    // (no CORS dance). /trpc carries queries; /api carries the login/logout
    // REST endpoints (cookie handling). /docs + /openapi 是对接方公开文档路由,
    // 不经代理时 vite 会把它们回退到 SPA index.html 并跳回 dashboard。
    proxy: {
      "/trpc": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/docs": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/openapi": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
