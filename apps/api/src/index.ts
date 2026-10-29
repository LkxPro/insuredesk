import "./load-env.ts";
import { systemClock } from "./clock.ts";
import { prisma } from "./db.ts";
import { type Env, parseEnv } from "./env.ts";
import { buildServer } from "./server.ts";
import { startCallbackDeliveryWorker } from "./services/callback-delivery.service.ts";
import { startHuifuWorker } from "./services/huifu-worker.ts";

async function main() {
  let env: Env;
  try {
    env = parseEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = buildServer(env);
  const huifuWorker = startHuifuWorker({
    prisma,
    clock: systemClock,
    enabled: Boolean(env.HUIFU_WEBHOOK_SECRET && env.HUIFU_WEBHOOK_MERCHANT_IDS?.trim()),
    slaPolicyId: env.HUIFU_WEBHOOK_SLA_POLICY_ID,
    log: app.log,
  });

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
    await huifuWorker.stop();
  });

  try {
    // Fastify 绑定 0.0.0.0 时按网卡重复输出监听日志。
    app.log.level = "warn";
    let address: string;
    try {
      address = await app.listen({ host: env.HOST, port: env.PORT });
    } finally {
      app.log.level = env.LOG_LEVEL;
    }
    // pino-pretty 会把 version 额外字段折成第二行。
    const fields = env.NODE_ENV === "production" ? { version: env.APP_VERSION } : {};
    app.log.info(fields, `Server listening at ${address}`);
  } catch (error) {
    callbackWorker.stop();
    await huifuWorker.stop();
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

void main();
