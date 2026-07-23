import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["test/**/*.test.ts"],
          // 共享 Postgres 容器只随 integration 项目在 global setup 起一次，
          // src 下的单测跑起来不碰 Docker。首跑还要拉镜像，故超时放宽。
          globalSetup: ["./test/global-setup.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
