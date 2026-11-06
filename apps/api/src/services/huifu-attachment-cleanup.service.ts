import { createHash } from "node:crypto";
import { huifuWebhookEventSchema } from "@insuredesk/shared";
import type { PrismaClient } from "../generated/prisma/client.ts";

export async function removeStoredHuifuAttachments(prisma: PrismaClient, apply = false) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`LOCK TABLE huifu_webhook_events, tickets, ticket_complaint_details, process_logs IN SHARE ROW EXCLUSIVE MODE`;
      const rows = await tx.huifuWebhookEvent.findMany({
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      });
      const canonical = new Map<string, (typeof rows)[number]>();
      const prepared = rows.map((row) => {
        const payload = JSON.parse(row.rawBody);
        const event = huifuWebhookEventSchema.parse(payload);
        const suffix = payload.attachmentList
          ? `\n附件（汇付原值）：${Array.isArray(payload.attachmentList) ? JSON.stringify(payload.attachmentList) : payload.attachmentList}`
          : null;
        const hadAttachments =
          Object.hasOwn(payload, "attachmentList") || Object.hasOwn(payload, "attachment_list");
        delete payload.attachmentList;
        delete payload.attachment_list;
        const digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
        const winner = canonical.get(digest);
        // 已处理记录优先，避免仅附件不同的待处理副本再次发出留言和通知。
        if (!winner || (winner.status !== "processed" && row.status === "processed"))
          canonical.set(digest, row);
        return { row, digest, suffix, hadAttachments, rawBody: JSON.stringify(payload) };
      });
      const textChanges = new Map<string, string>();
      const detailChanges = new Map<string, string>();
      for (const item of prepared) {
        if (!item.suffix) continue;
        const mapping = await tx.huifuComplaint.findUnique({
          where: {
            eventType_merchantId_complaintId: {
              eventType: item.row.eventType,
              merchantId: item.row.merchantId,
              complaintId: item.row.complaintId,
            },
          },
        });
        if (!mapping) continue;
        const strip = (value: string) => {
          if (item.suffix && value.includes(item.suffix)) return value.replaceAll(item.suffix, "");
          const index = value.lastIndexOf("\n附件（汇付原值）：");
          return index >= 0 && item.suffix?.startsWith(value.slice(index))
            ? value.slice(0, index)
            : value;
        };
        const logs = await tx.processLog.findMany({
          where: {
            ticketId: mapping.ticketId,
            operatorId: "huifu",
            action: { in: ["create", "external_note"] },
          },
        });
        for (const log of logs) {
          const value = textChanges.get(log.id) ?? log.remark;
          if (strip(value) !== value) textChanges.set(log.id, strip(value));
        }
        const detail = await tx.ticketComplaintDetail.findUnique({
          where: { ticketId: mapping.ticketId },
        });
        if (detail?.customerRequest) {
          const value = detailChanges.get(mapping.ticketId) ?? detail.customerRequest;
          if (strip(value) !== value) detailChanges.set(mapping.ticketId, strip(value));
        }
      }
      const changes = prepared.flatMap((item) => {
        const winner = canonical.get(item.digest);
        const duplicate = winner?.id !== item.row.id;
        const digest = duplicate
          ? createHash("sha256").update(`huifu-attachment-duplicate:${item.row.id}`).digest("hex")
          : item.digest;
        const status = duplicate && item.row.status === "pending" ? "ignored" : item.row.status;
        return item.hadAttachments || digest !== item.row.digest || status !== item.row.status
          ? [{ ...item, digest, status }]
          : [];
      });
      const changedEvents = changes.length;
      const changedLogs = textChanges.size;
      const changedDetails = detailChanges.size;
      if (apply) {
        // 两阶段重写摘要，避免历史等价事件之间的唯一索引冲突；保留所有接收记录。
        for (const item of changes)
          await tx.huifuWebhookEvent.update({
            where: { id: item.row.id },
            data: { digest: `attachment-cleanup:${item.row.id}` },
          });
        for (const item of changes)
          await tx.huifuWebhookEvent.update({
            where: { id: item.row.id },
            data: { digest: item.digest, status: item.status, rawBody: item.rawBody },
          });
        for (const [id, remark] of textChanges)
          await tx.processLog.update({ where: { id }, data: { remark } });
        for (const [ticketId, customerRequest] of detailChanges) {
          await tx.ticketComplaintDetail.update({ where: { ticketId }, data: { customerRequest } });
          await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
        }
      }
      return { apply, scanned: rows.length, changedEvents, changedLogs, changedDetails };
    },
    { timeout: 120_000 },
  );
}
