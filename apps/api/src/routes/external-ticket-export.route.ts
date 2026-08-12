import { externalTicketExportInputSchema } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { exportExternalTickets } from "../services/external-ticket-export.service";
import { splitMultiValueParams } from "./ticket-export.route";

/**
 * 外部导出工单 download endpoint — REST rather than tRPC because the response
 * is a file, not JSON（与内部导出同型）。Guard 顺序：401 未登录，403 非外部
 * 账号（管理员也不能走外部口子），400 schema 拒绝。导出对任何外部账号恒开，
 * 数据范围由 service 锁定为本人提交的单。
 */
export function registerExternalTicketExportRoute(app: FastifyInstance) {
  app.get("/api/external-tickets/export", async (req, reply) => {
    const user = req.authenticatedUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!user.isExternal) {
      return reply.code(403).send({ error: "该入口仅限外部账号使用" });
    }

    // status 是外部筛选里唯一的多选参数
    const parsed = externalTicketExportInputSchema.safeParse(
      splitMultiValueParams(req.query as Record<string, unknown>, ["status"]),
    );
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid export query", zodError: parsed.error.flatten() });
    }

    const file = await exportExternalTickets({ prisma, clock: systemClock }, user, parsed.data);
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  });
}
