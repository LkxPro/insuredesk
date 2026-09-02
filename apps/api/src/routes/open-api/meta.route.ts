import {
  NUCLEAR_BODY_STATUSES,
  openApiErrorBody,
  PRIORITY_LABELS,
  PROCESS_LOG_ACTION_LABELS,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
} from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { apiDb } from "../../db.ts";
import type { Env } from "../../env.ts";

export const OPEN_API_CONTRACT_EVOLUTION =
  "契约演化承诺：/api/v1 内只加字段、不改类型、不删字段；任何 breaking 变更走 /api/v2。";

export const OPEN_API_INCREMENTAL_CAVEATS = [
  "重叠窗口：增量拉取应把 since/updatedSince 回拨一个重叠窗口（分钟级）并按 id 幂等去重——并发事务的可见顺序可能与 at/updatedAt 值序错位，重叠重拉兜底。",
  "tombstone：软删工单在 /api/v1/tickets 增量流中以 tombstone 最小形状（id/workOrderNumber/deletedAt/updatedAt/tombstone）流出，下游据 deletedAt 抹除本地副本；/api/v1/process-logs 不出 tombstone，父单软删后其日志照常流出。",
  "displayStatus 是读时计算态：计算态跃迁不产生增量事件，下游不得等待推送，须按同一规则自行重算——status 为 completed 或 dueAt 为空时 displayStatus 等于 status；当前时刻已过 dueAt 为 overdue；距 dueAt 不足 2 小时为 pending_timeout。",
  "字典 name 是读时 join 的当前值、非历史快照：目录改名不产生工单或日志的增量事件，下游须以 id 为键缓存，并经 /api/v1/meta 刷新 name 映射。",
  "/api/v1/process-logs 含 internalOnly=true 的内部跟进（对齐内部导出口径）：面向外部数据使用方的下游须自行过滤。",
] as const;

const enumEntrySchema = z.object({ value: z.string(), label: z.string() }).strict();

const dictionaryEntrySchema = z
  .object({ id: z.string(), name: z.string(), active: z.boolean() })
  .strict();

export const openApiMetaResponseSchema = z
  .object({
    version: z.string(),
    spec: z.string(),
    docs: z.string(),
    enums: z
      .object({
        "ticket.status": z.array(enumEntrySchema),
        "ticket.displayStatus": z.array(enumEntrySchema),
        "ticket.source": z.array(enumEntrySchema),
        "complaint.priority": z.array(enumEntrySchema),
        "complaint.nuclearBodyStatus": z.array(enumEntrySchema),
        "processLog.action": z.array(enumEntrySchema),
      })
      .strict(),
    caveats: z
      .object({
        contractEvolution: z.string(),
        incremental: z.array(z.string()).length(5),
      })
      .strict(),
    dictionaries: z
      .object({
        ticketKinds: z.array(
          z
            .object({
              id: z.string(),
              key: z.string(),
              name: z.string(),
              active: z.boolean(),
            })
            .strict(),
        ),
        channels: z.array(dictionaryEntrySchema),
        categories: z.array(dictionaryEntrySchema),
        slaPolicies: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              active: z.boolean(),
              kindId: z.string(),
            })
            .strict(),
        ),
        completionStatuses: z.array(dictionaryEntrySchema),
        userFeedbackChannels: z.array(dictionaryEntrySchema),
        feedbackReceiveChannels: z.array(dictionaryEntrySchema),
      })
      .strict(),
  })
  .strict();

export type OpenApiMetaResponse = z.infer<typeof openApiMetaResponseSchema>;

function enumEntries(labels: Record<string, string>): Array<{ value: string; label: string }> {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

const byDisplayOrder = [{ displayOrder: "asc" }, { id: "asc" }] as Array<{
  displayOrder?: "asc";
  id?: "asc";
}>;

export function registerMetaRoute(app: FastifyInstance, env: Env) {
  app.get("/meta", async (req, reply) => {
    const auth = req.apiKeyAuth;
    if (!auth?.user) {
      return reply.code(401).send(openApiErrorBody("unauthorized", "Invalid API key"));
    }

    const [
      ticketKinds,
      channels,
      categories,
      slaPolicies,
      completionStatuses,
      userFeedbackChannels,
      feedbackReceiveChannels,
    ] = await Promise.all([
      apiDb.ticketKind.findMany({
        orderBy: byDisplayOrder,
        select: { id: true, key: true, name: true, active: true },
      }),
      apiDb.channel.findMany({
        orderBy: byDisplayOrder,
        select: { id: true, name: true, active: true },
      }),
      apiDb.ticketCategory.findMany({
        orderBy: byDisplayOrder,
        select: { id: true, name: true, active: true },
      }),
      apiDb.slaPolicy.findMany({
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, name: true, active: true, kindId: true },
      }),
      apiDb.completionStatus.findMany({
        orderBy: byDisplayOrder,
        select: { id: true, name: true, active: true },
      }),
      apiDb.userFeedbackChannel.findMany({
        orderBy: byDisplayOrder,
        select: { id: true, name: true, active: true },
      }),
      apiDb.feedbackReceiveChannel.findMany({
        orderBy: byDisplayOrder,
        select: { id: true, name: true, active: true },
      }),
    ]);

    req.apiRowCount =
      ticketKinds.length +
      channels.length +
      categories.length +
      slaPolicies.length +
      completionStatuses.length +
      userFeedbackChannels.length +
      feedbackReceiveChannels.length;

    return {
      version: env.APP_VERSION,
      spec: "/api/v1/openapi.json",
      docs: "/docs/analytics",
      enums: {
        "ticket.status": TICKET_STATUSES.map((value) => ({
          value,
          label: TICKET_STATUS_LABELS[value],
        })),
        "ticket.displayStatus": enumEntries(TICKET_STATUS_LABELS),
        "ticket.source": enumEntries(TICKET_SOURCE_LABELS),
        "complaint.priority": enumEntries(PRIORITY_LABELS),
        "complaint.nuclearBodyStatus": NUCLEAR_BODY_STATUSES.map((value) => ({
          value,
          label: value,
        })),
        "processLog.action": enumEntries(PROCESS_LOG_ACTION_LABELS),
      },
      caveats: {
        contractEvolution: OPEN_API_CONTRACT_EVOLUTION,
        incremental: [...OPEN_API_INCREMENTAL_CAVEATS],
      },
      dictionaries: {
        ticketKinds,
        channels,
        categories,
        slaPolicies,
        completionStatuses,
        userFeedbackChannels,
        feedbackReceiveChannels,
      },
    } satisfies OpenApiMetaResponse;
  });
}
