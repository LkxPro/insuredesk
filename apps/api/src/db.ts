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

/**
 * 惰性构造：import 本模块不依赖 env 加载顺序。pg 拿到空连接串会静默回落
 * libpq 默认，缺 DATABASE_URL 必须在 initClient 里显式报错。
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    client ??= initClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
