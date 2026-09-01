import { describe, expect, it } from "vitest";
import { type ApiAccessLogEntry, writeApiAccessLog } from "./api-access-log.service.ts";

const entry: ApiAccessLogEntry = {
  keyId: "key-1",
  userId: "user-1",
  endpoint: "GET /api/v1/me",
  statusCode: 200,
  durationMs: 12,
  rowCount: 1,
  ip: "203.0.113.9",
  requestId: "req-1",
  at: new Date("2026-09-02T00:00:00.000Z"),
};

function stubLog() {
  const warnings: { obj: unknown; msg: string }[] = [];
  return {
    warnings,
    warn(obj: unknown, msg: string) {
      warnings.push({ obj, msg });
    },
  };
}

describe("writeApiAccessLog", () => {
  it("正常写入：字段原样透传 create", async () => {
    const created: unknown[] = [];
    const prisma = {
      apiAccessLog: {
        create: (args: { data: ApiAccessLogEntry }) => {
          created.push(args.data);
          return Promise.resolve({});
        },
      },
    };
    await writeApiAccessLog({ prisma }, entry, stubLog());
    expect(created).toEqual([entry]);
  });

  it("写失败降级 pino，不向调用方抛错", async () => {
    const prisma = {
      apiAccessLog: {
        create: () => Promise.reject(new Error("db down")),
      },
    };
    const log = stubLog();
    await expect(writeApiAccessLog({ prisma }, entry, log)).resolves.toBeUndefined();
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]?.obj).toMatchObject({ entry });
  });
});
