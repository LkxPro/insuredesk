export interface ApiAccessLogEntry {
  keyId: string;
  userId: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  rowCount: number;
  ip: string;
  requestId: string;
  at: Date;
}

export interface ApiAccessLogWriter {
  apiAccessLog: {
    create(args: { data: ApiAccessLogEntry }): Promise<unknown>;
  };
}

interface Deps {
  prisma: ApiAccessLogWriter;
}

export interface AuditFallbackLog {
  warn(obj: object, msg: string): void;
}

export async function writeApiAccessLog(
  { prisma }: Deps,
  entry: ApiAccessLogEntry,
  log: AuditFallbackLog,
): Promise<void> {
  try {
    await prisma.apiAccessLog.create({ data: entry });
  } catch (error) {
    log.warn({ err: error, entry }, "api access log write failed");
  }
}
