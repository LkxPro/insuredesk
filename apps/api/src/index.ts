import { existsSync } from "node:fs";
import { type Env, parseEnv } from "./env";
import { buildServer } from "./server";

// Load apps/api/.env for local/dev before validating. In production the platform
// injects real env vars, so an absent file is expected and fine. Scripts run with
// cwd = apps/api, so the relative path resolves correctly.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

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
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

void main();
