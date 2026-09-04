import {
  NUCLEAR_BODY_STATUSES,
  openApiErrorBody,
  POLICY_NUMBER_STATE_FILTER_LABELS,
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
  "重叠窗口：增量拉取把 updatedSince 往回拨几分钟作为重叠窗口，并按 id 幂等去重——并发事务的可见顺序可能与 updatedAt 不一致，不回拨会漏行。",
  "tombstone：软删工单在 /api/v1/tickets 增量流里以 tombstone 行返回（只有 id/workOrderNumber/deletedAt/updatedAt/tombstone 五个字段），下游据 deletedAt 删除本地副本；/api/v1/process-logs 不出 tombstone，父工单软删后日志照常返回。",
  "displayStatus 是实时计算的：计算态跃迁不产生增量事件，下游不要等推送，要按同一规则自行重算。按序判定：status=completed 或 dueAt 为空 → 等于 status；已过 dueAt → overdue；距 dueAt 不足 2 小时 → pending_timeout；否则等于 status。",
  "字典的 name 是读取时的当前值，不是历史快照：目录改名不产生工单或日志的增量事件，下游以 id 为键缓存，要刷新 name 时重拉 /api/v1/meta。",
  "/api/v1/process-logs 包含 internalOnly=true 的内部跟进记录；数据要交给外部使用方的下游，请自行过滤这些行。",
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
        "ticket.policyNumberState": z.array(enumEntrySchema),
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
      return reply
        .code(401)
        .header("WWW-Authenticate", "Bearer")
        .send(openApiErrorBody("unauthorized", "Invalid API key"));
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
        "ticket.policyNumberState": enumEntries(POLICY_NUMBER_STATE_FILTER_LABELS),
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
