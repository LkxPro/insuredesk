import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createLogger } from "vite";
import { defineConfig } from "vitest/config";

// API 未启动时代理会反复报 ECONNREFUSED，省略预期的连接失败日志。
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
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // 并发过高会耗尽机器资源，导致异步测试偶发失败。
    maxWorkers: 2,
    // 必须高于 setup.ts 的 asyncUtilTimeout，避免提前终止轮询。
    testTimeout: 15000,
  },
  server: {
    // 自动递增端口会使 dev-up.sh 就绪轮询、make open 端口推导失效。
    strictPort: true,
    port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : 5173,
    // macOS 的 localhost 可能优先解析为 ::1，导致 127.0.0.1 无法访问。
    host: "127.0.0.1",
    // /docs、/openapi 不经代理会回退到 SPA index.html 并跳回 dashboard。
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
