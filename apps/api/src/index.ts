import "./load-env.ts";
import { type Env, parseEnv } from "./env.ts";
import { buildServer } from "./server.ts";

async function main() {
  let env: Env;
  try {
    env = parseEnv();
  } catch (error) {
    // Env is invalid — fail fast and loud before anything else spins up.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = buildServer(env);

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info({ version: env.APP_VERSION }, "Server started");
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

void main();
