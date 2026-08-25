import "./load-env.ts";
import { systemClock } from "./clock.ts";
import { prisma } from "./db.ts";
import { type Env, parseEnv } from "./env.ts";
import { buildServer } from "./server.ts";
import { startCallbackDeliveryWorker } from "./services/callback-delivery.service.ts";

async function main() {
  let env: Env;
  try {
    env = parseEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = buildServer(env);

  // onClose 必须在 listen 前注册（fastify 监听后拒收钩子）。
  const callbackWorker = startCallbackDeliveryWorker({
    prisma,
    clock: systemClock,
    config: {
      callbackUrl: env.JB_INSURANCE_CALLBACK_URL,
      callbackSecret: env.JB_INSURANCE_CALLBACK_SECRET,
    },
    log: app.log,
  });
  app.addHook("onClose", async () => {
    callbackWorker.stop();
  });

  try {
    // 绑 0.0.0.0 时 fastify 按网卡逐条打 listen 日志；只在 listen 期间静音，
    // 成功后自己打一条汇总。监听行为不变。
    app.log.level = "warn";
    let address: string;
    try {
      address = await app.listen({ host: env.HOST, port: env.PORT });
    } finally {
      app.log.level = env.LOG_LEVEL;
    }
    // version 只在 prod 的 JSON 日志里是单行；dev 的 pino-pretty 会把额外字段
    // 折成第二行，喧宾夺主。
    const fields = env.NODE_ENV === "production" ? { version: env.APP_VERSION } : {};
    app.log.info(fields, `Server listening at ${address}`);
  } catch (error) {
    callbackWorker.stop();
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

void main();
