import multipart from "@fastify/multipart";
import {
  TICKET_IMPORT_MAX_FILE_BYTES,
  type TicketImportFailure,
  type TicketImportSuccess,
} from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { importTickets, TicketImportValidationError } from "../services/ticket-import.service.ts";

export function registerTicketImportRoute(app: FastifyInstance) {
  app.register(multipart, {
    // 文件 ≤2MB、单文件 — oversize aborts the parse, which surfaces as
    // FST_REQ_FILE_TOO_LARGE below rather than buffering the whole body.
    limits: { fileSize: TICKET_IMPORT_MAX_FILE_BYTES, files: 1 },
  });

  app.post("/api/tickets/import", async (req, reply) => {
    const user = req.authenticatedUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!user.permissions.includes("ticket.import")) {
      return reply.code(403).send({ error: "Missing required permission: ticket.import" });
    }
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "请以 multipart/form-data 上传文件" });
    }

    const part = await req.file();
    if (!part) {
      return reply.code(400).send({ error: "请求中缺少文件" });
    }

    let body: Buffer;
    try {
      body = await part.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({
          error: `文件大小超过 ${TICKET_IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB 上限`,
          rowErrors: [],
        } satisfies TicketImportFailure);
      }
      throw error;
    }

    try {
      const result = await importTickets({ prisma, clock: systemClock }, user, {
        body,
        filename: part.filename || "import.xlsx",
        timeZone: fieldValue(part.fields.timeZone),
      });
      return { imported: result.imported } satisfies TicketImportSuccess;
    } catch (error) {
      if (error instanceof TicketImportValidationError) {
        return reply
          .code(400)
          .send({ error: error.message, rowErrors: error.rowErrors } satisfies TicketImportFailure);
      }
      throw error;
    }
  });
}

/** First string value of a multipart form field (fields precede the file part). */
function fieldValue(field: unknown): string | undefined {
  const single = Array.isArray(field) ? field[0] : field;
  const value = (single as { value?: unknown } | undefined)?.value;
  return typeof value === "string" && value ? value : undefined;
}
