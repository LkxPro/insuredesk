import {
  openApiErrorBodySchema,
  openApiProcessLogListResponseSchema,
  openApiProcessLogsInputSchema,
  openApiTicketListResponseSchema,
  openApiTicketsInputSchema,
} from "@insuredesk/shared";
import { z } from "zod";
import type { Env } from "../env.ts";
import { openApiMeResponseSchema } from "../routes/open-api/me.route.ts";
import {
  OPEN_API_CONTRACT_EVOLUTION,
  OPEN_API_INCREMENTAL_CAVEATS,
  openApiMetaResponseSchema,
} from "../routes/open-api/meta.route.ts";

type Json = Record<string, unknown>;

interface OpenApiEndpointSpec {
  path: string;
  summary: string;
  description: string;
  query?: z.ZodType;
  queryDescriptions?: Record<string, string>;
  response: z.ZodType;
  responseDescriptions: Record<string, string>;
}

const PAGINATION_QUERY_DESCRIPTIONS: Record<string, string> = {
  limit: "每页条数（1–200，缺省 200）",
  cursor:
    "上一页响应的 nextCursor 原样回传；游标绑定签发时的模式和筛选参数，换参数续翻报 invalid_cursor",
};

const LIST_WRAPPER_DESCRIPTIONS: Record<string, string> = {
  hasMore: "是否还有下一页",
  nextCursor: "下一页游标，翻页时回传给 cursor 参数；没有下一页时为 null",
  nextUrl: "下一页相对路径，拼上 API host 直接 GET；没有下一页时为 null",
};

const ERROR_ENVELOPE_DESCRIPTIONS: Record<string, string> = {
  error: "顶层错误对象",
  code: "错误码（机器可读）",
  message: "错误消息（人类可读）",
};

const MULTI_VALUE_HINT = "逗号分隔或重复传参均可";

const ENDPOINTS: OpenApiEndpointSpec[] = [
  {
    path: "/api/v1/tickets",
    summary: "工单明细（翻页 / 增量同步）",
    description:
      "每行一个工单，字段平铺：投诉侧表字段带 complaint_ 前缀、退费侧表带 refund_ 前缀，与工单种类不匹配的侧表字段恒为 null。\n\n" +
      "需要 ticket.export 权限。数据范围与 key 持有人相同：没有 ticket.view_all 只能看到本人负责或创建的工单。\n\n" +
      "两种模式：缺省按 (createdAt desc, id desc) 翻页，不含软删行；传 updatedSince 切增量同步，按 (updatedAt asc, id asc) 翻页，" +
      "软删行以 tombstone 行返回。增量同步的注意事项见 /api/v1/meta 的 caveats.incremental。",
    query: openApiTicketsInputSchema,
    queryDescriptions: {
      ...PAGINATION_QUERY_DESCRIPTIONS,
      updatedSince:
        "传了就是增量同步模式：返回 updatedAt >= 该时刻的行（含等于，ISO 8601 带时区），按 (updatedAt asc, id asc) 翻页，软删行以 tombstone 行返回",
      status: `按 displayStatus 过滤（含计算态 pending_timeout/overdue；取值见 meta ticket.displayStatus）；${MULTI_VALUE_HINT}`,
      channelId: `按渠道 id 过滤（字典见 meta channels；退费单没有渠道，恒不命中）；${MULTI_VALUE_HINT}`,
      categoryId: `按客诉类别 id 过滤（字典见 meta categories；退费单恒不命中）；${MULTI_VALUE_HINT}`,
      completionStatusId: `按完结状态 id 过滤（字典见 meta completionStatuses）；${MULTI_VALUE_HINT}`,
      slaPolicyId: `按时效策略 id 过滤（字典见 meta slaPolicies）；${MULTI_VALUE_HINT}`,
      kindId: `按工单种类 id 过滤（字典见 meta ticketKinds）；${MULTI_VALUE_HINT}`,
      policyNumberState: `按保单号状态过滤（取值见 meta ticket.policyNumberState）；${MULTI_VALUE_HINT}`,
      source: `按来源过滤（取值见 meta ticket.source）；缺省含全部来源（含 file_import）；${MULTI_VALUE_HINT}`,
      search: "模糊匹配工单号/客户姓名/客户电话/联系电话/保单号；最长 100 字符",
      createdFrom: "创建时间下界（含等于，ISO 8601 带时区）",
      createdTo: "创建时间上界（含等于，ISO 8601 带时区）",
      fields:
        "只要这些字段（逗号分隔，取值为 data 行的属性名）。增量同步必须保留 updatedAt（游标排序键），否则无法续翻；tombstone 行不受投影影响",
    },
    response: openApiTicketListResponseSchema,
    responseDescriptions: {
      ...LIST_WRAPPER_DESCRIPTIONS,
      data: "本页数据行；增量模式下软删工单以 tombstone 行混在其中（tombstone=true）",
      id: "工单 ID",
      workOrderNumber: "工单号",
      deletedAt: "软删时刻（仅 tombstone 行）；下游据此删除本地副本",
      updatedAt: "最近更新时间；增量模式的游标排序键",
      tombstone:
        "软删标记，恒为 true；该行只有 id/workOrderNumber/deletedAt/updatedAt/tombstone 五个字段",
      source: "来源（取值与中文 label 见 meta ticket.source；未知取值原样透传）",
      status: "存储的基础状态（见 meta ticket.status；未知取值原样透传）",
      displayStatus:
        "实时计算的展示状态（见 meta ticket.displayStatus）；计算态跃迁不产生增量事件，重算规则见 meta caveats",
      kindId: "工单种类 id（见 meta 字典 ticketKinds）",
      kindKey:
        "工单种类 key（complaint=投诉，refund_exception=退费异常）；不匹配的侧表字段恒为 null",
      contactPhone: "联系电话",
      slaPolicyId: "时效策略 id（见 meta 字典 slaPolicies）",
      slaPolicyName: "时效策略名称（当前值，非快照）",
      assigneeId: "责任人用户 id",
      assigneeName: "责任人姓名（当前值，非快照）",
      creatorId: "建单人用户 id（外部来源工单为 null）",
      createdBy: "创建者：creator 来源取建单人当前姓名，外部来源取来源标签",
      createdAt: "创建时间；缺省翻页模式的游标排序键",
      assignedAt: "分配时间",
      dueAt: "处理时限",
      nextContactTime: "下次联系时间",
      contactCount: "联系次数",
      followUpFrequency: "跟进频次（文本）",
      firstResponseRequirement: "首响要求（文本）",
      completionTime: "完结时间",
      completionStatusId: "完结状态 id（见 meta 字典 completionStatuses）",
      completionStatusName: "完结状态名称（当前值，非快照）",
      processLogsText:
        "跟进记录拼接文本：只拼 action=comment 的行，按 at 升序，含 internalOnly 行；结构化日志走 /api/v1/process-logs",
      complaint_feedbackTime: "反馈时间（投诉侧表字段，非投诉单恒为 null）",
      complaint_channelId: "渠道 id（见 meta 字典 channels）",
      complaint_channelName: "渠道名称（当前值，非快照）",
      complaint_project: "项目",
      complaint_brokerageEntity: "经纪主体",
      complaint_paymentChannel: "支付渠道",
      complaint_internalOrderNumber: "内部订单号",
      complaint_policyNumbers: "保单号数组",
      complaint_noPolicyNumber: "是否无保单号",
      complaint_userFeedbackChannelId: "用户反馈渠道 id（见 meta 字典 userFeedbackChannels）",
      complaint_userFeedbackChannelName: "用户反馈渠道名称（当前值，非快照）",
      complaint_feedbackReceiveChannelId:
        "反馈信息接收渠道 id（见 meta 字典 feedbackReceiveChannels）",
      complaint_feedbackReceiveChannelName: "反馈信息接收渠道名称（当前值，非快照）",
      complaint_customerName: "客户姓名",
      complaint_phone: "客户电话",
      complaint_customerRequest: "客户诉求",
      complaint_nuclearBodyStatus:
        "核身状态（见 meta complaint.nuclearBodyStatus；未知取值原样透传）",
      complaint_hasContacted: "是否已联系",
      complaint_contactTime: "进线时间",
      complaint_contactId: "联系 ID",
      complaint_categoryId: "客诉类别 id（见 meta 字典 categories）",
      complaint_categoryName: "客诉类别名称（当前值，非快照）",
      complaint_priority: "优先级（见 meta complaint.priority；未知取值原样透传）",
      refund_platform: "推送平台（退费侧表字段，非退费单恒为 null）",
      refund_endorNo: "批单号；与 platform 组成推送幂等键",
      refund_sysOrderId: "平台系统订单号",
      refund_workOrderType: "平台工单类型（纯展示文本，平台新增类型不做枚举校验）",
      refund_expectedAmount: "应退金额（字符串原样，系统不做数值运算）",
      refund_refundCreateTime: "平台退费申请时刻",
      refund_refundTrades: "期次明细（平台推送原文 JSON 数组）",
      refund_holderName: "投保人姓名",
      refund_holderPhone: "投保人电话",
      refund_companyName: "保险公司",
      refund_productId: "产品 id",
      refund_productName: "产品名称",
      refund_policyNo: "保单号",
      refund_failureReason: "退费异常原因",
      refund_pushedFields: "平台推送时实际携带的字段清单",
      refund_compensationAmount: "补偿金（诚意金）",
    },
  },
  {
    path: "/api/v1/process-logs",
    summary: "处理日志（翻页 / 增量同步）",
    description:
      "工单的处理日志，含 internalOnly=true 的内部跟进；父工单软删后日志照常返回。\n\n" +
      "需要 ticket.export 权限。数据范围按所属工单计算：没有 ticket.view_all 只能看到本人负责或创建工单的日志。\n\n" +
      "缺省按 (at desc, id desc) 翻页；传 updatedSince 切增量同步，按 (at asc, id asc) 翻页。" +
      "注意：日志没有 updatedAt，updatedSince 与 at 比较。",
    query: openApiProcessLogsInputSchema,
    queryDescriptions: {
      ...PAGINATION_QUERY_DESCRIPTIONS,
      ticketId: "按所属工单 id 过滤（仍受 key 持有人的数据范围限制）",
      updatedSince:
        "传了就是增量同步模式：返回 at >= 该时刻的日志（含等于，ISO 8601 带时区），按 (at asc, id asc) 翻页",
    },
    response: openApiProcessLogListResponseSchema,
    responseDescriptions: {
      ...LIST_WRAPPER_DESCRIPTIONS,
      data: "本页日志行",
      id: "日志 ID",
      ticketId: "所属工单 ID",
      workOrderNumber: "所属工单号（当前值）",
      action: "动作（取值见 meta processLog.action；未知取值原样透传）",
      operatorId: "操作人用户 id",
      operatorName: "操作人姓名快照",
      from: "变更前值（assign → 姓名快照，status_change → 状态枚举；其余动作为 null）",
      to: "变更后值（格式同 from）",
      remark: "备注 / 跟进正文",
      internalOnly: "仅内部可见标记；true 的行照常返回，数据交给外部使用方时下游自行过滤",
      at: "发生时刻；游标排序键",
    },
  },
  {
    path: "/api/v1/meta",
    summary: "数据字典与契约说明",
    description:
      "枚举取值与中文 label、七类字典目录快照（id → 当前 name/active）、增量同步注意事项。\n\n" +
      "任意有效的内部 key 可读，不需要 ticket.export。",
    response: openApiMetaResponseSchema,
    responseDescriptions: {
      version: "服务版本（发布 tag）",
      spec: "OpenAPI 3.1 文档地址（公开，无需 key）",
      docs: "交互式文档地址",
      enums: "枚举值与中文 label 对照；键为 API 字段路径",
      "ticket.status": "工单存储的基础状态",
      "ticket.displayStatus": "工单展示状态（存储态 + 计算态 pending_timeout/overdue）",
      "ticket.source": "工单来源",
      "ticket.policyNumberState": "保单号状态（none = 无保单号）",
      "complaint.priority": "投诉单优先级",
      "complaint.nuclearBodyStatus": "投诉单核身状态（中文枚举字面值即存储值）",
      "processLog.action": "处理日志动作",
      caveats: "契约注意事项，接入前必读",
      contractEvolution: "契约演化承诺",
      incremental: "增量同步注意事项",
      dictionaries: "字典目录快照（id → 当前 name/active）",
      ticketKinds: "工单种类目录",
      channels: "反馈渠道目录",
      categories: "客诉类别目录",
      slaPolicies: "时效策略目录",
      completionStatuses: "完结状态目录",
      userFeedbackChannels: "用户反馈渠道目录",
      feedbackReceiveChannels: "反馈信息接收渠道目录",
      id: "目录行 id",
      key: "行为绑定 key（创建后不可改）",
      name: "目录行当前名称",
      active: "是否启用（停用的退出录入下拉，存量引用照常显示）",
      kindId: "所属工单种类 id",
      value: "枚举原始值（存储/传输值）",
      label: "枚举中文 label",
    },
  },
  {
    path: "/api/v1/me",
    summary: "当前 key 的身份与权限",
    description: "返回 key 持有人的账号、角色、权限清单和数据范围。用于验证 key 是否生效。",
    response: openApiMeResponseSchema,
    responseDescriptions: {
      user: "key 持有人的账号",
      "user.id": "用户 id",
      "user.username": "登录名",
      "user.name": "姓名",
      "user.email": "邮箱",
      "user.team": "团队",
      role: "角色",
      "role.id": "角色 id",
      "role.name": "角色名称",
      permissions: "权限点清单",
      dataScope: "工单数据范围：all = 全部工单，own = 仅本人负责或创建的工单",
    },
  },
];

function stripSchemaDialect(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripSchemaDialect);
  }
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Json)
        .filter(([key]) => key !== "$schema")
        .map(([key, value]) => [key, stripSchemaDialect(value)]),
    );
  }
  return node;
}

function applyDescriptions(
  node: unknown,
  descriptions: Record<string, string>,
  trail: readonly string[] = [],
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => applyDescriptions(item, descriptions, trail));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "properties" && value !== null && typeof value === "object") {
      out[key] = Object.fromEntries(
        Object.entries(value as Json).map(([name, prop]) => {
          const description = descriptions[[...trail, name].join(".")] ?? descriptions[name];
          return [
            name,
            applyDescriptions(
              description !== undefined &&
                prop !== null &&
                typeof prop === "object" &&
                !Array.isArray(prop)
                ? { ...(prop as Json), description }
                : prop,
              descriptions,
              [...trail, name],
            ),
          ];
        }),
      );
    } else {
      out[key] = applyDescriptions(value, descriptions, trail);
    }
  }
  return out;
}

function toParameter(name: string, schema: Json, description: string, required: boolean): Json {
  return {
    name,
    in: "query",
    required,
    description,
    ...(schema.type === "array" ? { style: "form", explode: false } : {}),
    schema,
  };
}

function buildParameters(spec: OpenApiEndpointSpec): Json[] {
  if (!spec.query) {
    return [];
  }
  const jsonSchema = z.toJSONSchema(spec.query, { io: "input" }) as Json;
  const required = new Set((jsonSchema.required as string[] | undefined) ?? []);
  const descriptions = spec.queryDescriptions ?? {};
  return Object.entries((jsonSchema.properties as Json | undefined) ?? {}).map(([name, schema]) =>
    toParameter(
      name,
      stripSchemaDialect(schema) as Json,
      descriptions[name] ?? "",
      required.has(name),
    ),
  );
}

function errorResponse(description: string): Json {
  return {
    description,
    content: {
      "application/json": {
        schema: applyDescriptions(
          stripSchemaDialect(z.toJSONSchema(openApiErrorBodySchema)),
          ERROR_ENVELOPE_DESCRIPTIONS,
        ),
      },
    },
  };
}

function buildOperation(spec: OpenApiEndpointSpec): Json {
  const responses: Json = {
    "200": {
      description: "成功",
      content: {
        "application/json": {
          schema: applyDescriptions(
            stripSchemaDialect(z.toJSONSchema(spec.response)),
            spec.responseDescriptions,
          ),
        },
      },
    },
    "401": errorResponse("缺少或无效的 API key（unauthorized）"),
    "403": errorResponse("key 无权限：外部角色 key，或缺少 ticket.export（forbidden）"),
    "429": errorResponse("触发限流（rate_limited；响应头 Retry-After 给出重试秒数）"),
    default: errorResponse(
      "服务侧错误（internal_error / concurrency_limit / query_timeout；5xx 可重试）",
    ),
  };
  if (spec.query) {
    responses["400"] = errorResponse("参数或游标非法（invalid_params / invalid_cursor）");
  }
  return {
    summary: spec.summary,
    description: spec.description,
    security: [{ bearerAuth: [] }],
    ...(spec.query ? { parameters: buildParameters(spec) } : {}),
    responses,
  };
}

export function buildOpenApiDocument(env: Env): Json {
  const infoDescription = [
    "InsureDesk 开放数据 API（/api/v1）：面向内部数据消费方与分析代理的只读接口。",
    [
      "## 认证",
      "请求头 `Authorization: Bearer sk_…`。key 在个人资料页（/profile）创建：默认 90 天过期，明文只在创建时显示一次。",
      "key 继承持有人的权限和数据范围；外部角色的 key 一律 403。`GET /api/v1/me` 可验证 key 是否生效。",
      "只有 `/api/v1`、`/api/v1/openapi.json`、`/docs/analytics` 三个地址公开，其余端点都要 key。",
    ].join("\n\n"),
    [
      "## 限流",
      "每个 key 约 120 次/分钟，超限返回 429，响应头 Retry-After 给出重试秒数。",
      "无效 key 按来源 IP 限流 20 次/分钟，锁定期间同 IP 的有效 key 连带 429（共享出口 IP 时注意）。",
    ].join("\n\n"),
    [
      "## 错误",
      '错误一律返回 `{ "error": { "code", "message" } }`。',
      "带参数的端点拒绝本文档未列出的参数名（400 invalid_params）；5xx 可以重试。",
    ].join("\n\n"),
    [
      "## 分页",
      "keyset 游标：响应带 nextCursor/nextUrl，把 nextCursor 回传给 cursor 参数翻下一页，nextCursor 为 null 即翻完。",
      "nextUrl 是相对路径，拼上 base URL 后直接 GET（已带上原筛选参数）。",
      "游标绑定签发时的模式和筛选参数，换参数续翻报 400 invalid_cursor。",
    ].join("\n\n"),
    [
      "## 增量同步",
      "首次全量：不带 updatedSince 沿 nextUrl 翻到结束，记下见过的最大 updatedAt；之后带 updatedSince=该值走增量。",
      '```\ncurl -H "Authorization: Bearer sk_…" "https://<host>/api/v1/tickets?limit=200"\n```',
      "最小同步循环：",
      [
        "```",
        "since = null                     // null = 首次全量",
        "loop:",
        "  page = GET /api/v1/tickets?limit=200 [&updatedSince=since 回拨 5 分钟]   // 重叠窗口，见注意事项 1",
        "  while page:",
        "    for row in page.data:",
        "      row.tombstone ? 删除本地 row.id : 按 id upsert                     // 重叠行幂等去重",
        "    page = page.hasMore ? GET (base URL + page.nextUrl) : null",
        "  since = 本轮见过的最大 updatedAt",
        "  等待一个周期，回 loop",
        "",
        "另两件不走增量事件的事：displayStatus 按注意事项 3 的规则本地重算；字典 name 定期重拉 /api/v1/meta 刷新",
        "```",
      ].join("\n"),
    ].join("\n\n"),
    [
      "## 增量同步注意事项",
      OPEN_API_INCREMENTAL_CAVEATS.map((caveat, index) => `${index + 1}. ${caveat}`).join("\n"),
    ].join("\n\n"),
    [
      "## 其他",
      "所有时间字段输出 UTC（ISO 8601，如 2026-09-01T08:30:00.000Z）；时间入参必须带时区。",
      "枚举字段原样透传，取值与中文 label 见 /api/v1/meta。",
      OPEN_API_CONTRACT_EVOLUTION,
    ].join("\n\n"),
  ].join("\n\n");

  return {
    openapi: "3.1.0",
    info: {
      title: "InsureDesk Open API",
      version: env.APP_VERSION,
      description: infoDescription,
    },
    servers: [{ url: "/" }],
    paths: Object.fromEntries(ENDPOINTS.map((spec) => [spec.path, { get: buildOperation(spec) }])),
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}
