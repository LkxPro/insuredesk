import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

writeFileSync(
  join(tmpdir(), "insuredesk-screenshot-setup-v2099.06.0.json"),
  JSON.stringify({ ranAt: Date.now(), webUrl: process.env.INSUREDESK_WEB_URL ?? null }),
);
