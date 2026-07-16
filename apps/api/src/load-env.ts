import { existsSync } from "node:fs";

// Module-level singletons (src/db.ts) read process.env while imports are still
// being evaluated, so `.env` must be loaded from a module imported ahead of
// them — a top-level statement in index.ts itself runs only after every import
// resolves. In production no `.env` file exists; the platform injects real env
// vars. Scripts run with cwd = apps/api, so the relative path resolves.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
