import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

let client: PrismaClient | undefined;

function initClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — put it in process.env (apps/api/.env in dev) before using the database",
    );
  }
  // adapter-pg 把 DateTime 序列化为无偏移的 UTC 墙钟串、交给会话时区解析（读路径
  // 再把偏移改写为 +00:00）——会话必须钉死 UTC，否则写入偏移。连接级 options 是
  // 保险丝：库级 timezone 已由迁移 20260826000000 归正，但换库/新库忘设时这里兜底。
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, options: "-c timezone=UTC" }),
  });
}

// pg 拿到空连接串会静默回落 libpq 默认，缺 DATABASE_URL 必须在 initClient
// 里显式报错。
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    client ??= initClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

let apiClient: PrismaClient | undefined;

function initApiClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — put it in process.env (apps/api/.env in dev) before using the database",
    );
  }
  // pg 池默认无限排队：max 4 + connectionTimeoutMillis 才是 /api/v1 的并发闸
  // （取连接超时映射 503），statement_timeout 是慢查询闸（映射 504）。
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 2000,
      options: "-c timezone=UTC -c statement_timeout=15000",
    }),
  });
}

export const apiDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    apiClient ??= initApiClient();
    const value = Reflect.get(apiClient, prop, apiClient);
    return typeof value === "function" ? value.bind(apiClient) : value;
  },
});
