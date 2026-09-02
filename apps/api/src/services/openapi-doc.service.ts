import {
  openApiErrorBodySchema,
  openApiProcessLogListResponseSchema,
  openApiProcessLogsInputSchema,
  openApiTicketListResponseSchema,
  openApiTicketsInputSchema,
} from "@insuredesk/shared";
import { z } from "zod";
import type { Env } from "../env.ts";
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
    "上一页响应的 nextCursor 原样回传；游标钉死签发它的模式与筛选集，改动任一参数续翻报 invalid_cursor",
};

const LIST_WRAPPER_DESCRIPTIONS: Record<string, string> = {
  hasMore: "是否还有下一页",
  nextCursor: "下一页游标（翻页时原样回传 cursor 参数）；无下一页时为 null",
  nextUrl: "下一页完整 URL（直接 GET 即可）；无下一页时为 null",
};

const ERROR_ENVELOPE_DESCRIPTIONS: Record<string, string> = {
  error: "错误信封",
  code: "错误码（机器可读）",
  message: "错误消息（人类可读）",
};

const MULTI_VALUE_HINT = "逗号分隔或重复传参均可";

const ENDPOINTS: OpenApiEndpointSpec[] = [
  {
    path: "/api/v1/tickets",
    summary: "工单明细（ad-hoc 翻页 / updatedSince 增量同步双模式）",
    description:
      "平铺的工单全字段行：侧表按 complaint_/refund_ 前缀平铺，kind 不匹配的侧表字段恒 null。" +
      "门禁 ticket.export；数据范围按 key 持有人的工单 RBAC（无 ticket.view_all 仅见本人负责/创建的工单）。" +
      "缺省 ad-hoc 模式按 (createdAt desc, id desc) 翻页、软删行不出现；传 updatedSince 切增量模式，" +
      "按 (updatedAt asc, id asc) 翻页且软删行以 tombstone 最小形状流出。增量契约注意事项见 /api/v1/meta。",
    query: openApiTicketsInputSchema,
    queryDescriptions: {
      ...PAGINATION_QUERY_DESCRIPTIONS,
      updatedSince:
        "传入即切增量同步模式：返回 updatedAt >= 该时刻的行（含等于，ISO 8601 带时区），按 (updatedAt asc, id asc) 翻页，软删行以 tombstone 流出",
      status: `按 displayStatus 过滤（含计算态 pending_timeout/overdue；取值见 meta ticket.displayStatus）；${MULTI_VALUE_HINT}`,
      channelId: `按渠道 id 过滤（meta 字典 channels；退费单无侧表渠道、恒不命中）；${MULTI_VALUE_HINT}`,
      categoryId: `按客诉类别 id 过滤（meta 字典 categories；退费单恒不命中）；${MULTI_VALUE_HINT}`,
      completionStatusId: `按完结状态 id 过滤（meta 字典 completionStatuses）；${MULTI_VALUE_HINT}`,
      slaPolicyId: `按时效策略 id 过滤（meta 字典 slaPolicies）；${MULTI_VALUE_HINT}`,
      kindId: `按工单种类 id 过滤（meta 字典 ticketKinds）；${MULTI_VALUE_HINT}`,
      policyNumberState: `保单号状态过滤：none = 无保单号；${MULTI_VALUE_HINT}`,
      source: `按来源过滤（取值见 meta ticket.source）；缺省 = 全来源含 file_import（有意偏离 UI 默认排除项）；${MULTI_VALUE_HINT}`,
      search: "模糊匹配工单号/客户姓名/客户电话/联系电话/保单号；最长 100 字符",
      createdFrom: "创建时间下界（含等于，ISO 8601 带时区）",
      createdTo: "创建时间上界（含等于，ISO 8601 带时区）",
      fields:
        "响应字段白名单投影（逗号分隔，取值为响应 data 属性名）；投影后响应只含所选字段——增量同步场景必须保留 updatedAt（游标排序键），否则无法续翻与对账；tombstone 行不受投影影响",
    },
    response: openApiTicketListResponseSchema,
    responseDescriptions: {
      ...LIST_WRAPPER_DESCRIPTIONS,
      data: "本页数据行；增量模式下软删行以 tombstone 最小形状混在其中（tombstone=true 标记）",
      id: "工单 ID",
      workOrderNumber: "工单号",
      deletedAt: "软删时刻（仅 tombstone 行）；下游据此抹除本地副本",
      updatedAt: "最近更新时间；增量模式的游标排序键",
      tombstone:
        "软删标记，恒 true；该行仅含 id/workOrderNumber/deletedAt/updatedAt/tombstone 五字段",
      source: "来源枚举原始值（取值与中文 label 见 meta ticket.source；未知取值原样透传）",
      status: "存储基础状态（见 meta ticket.status；未知取值原样透传）",
      displayStatus:
        "读时计算状态（见 meta ticket.displayStatus）；计算态跃迁不产生增量事件，下游重算规则见 meta caveats",
      kindId: "工单种类 id（见 meta 字典 ticketKinds）",
      kindKey:
        "工单种类行为绑定 key（complaint=投诉，refund_exception=退费异常）；不匹配的侧表字段恒 null",
      contactPhone: "联系电话",
      slaPolicyId: "时效策略 id（见 meta 字典 slaPolicies）",
      slaPolicyName: "时效策略当前名（读时 join，非快照）",
      assigneeId: "责任人用户 id",
      assigneeName: "责任人当前姓名（读时 join，非快照）",
      creatorId: "建单人用户 id（外部来源工单为 null）",
      createdBy: "由谁创建：creator 来源取建单人当前姓名，外部来源取来源标签",
      createdAt: "创建时间；ad-hoc 模式的游标排序键",
      assignedAt: "分配时间",
      dueAt: "处理时限",
      nextContactTime: "下次联系时间",
      contactCount: "联系次数",
      followUpFrequency: "跟进频次（文本）",
      firstResponseRequirement: "首响要求（文本）",
      completionTime: "完结时间",
      completionStatusId: "完结状态 id（见 meta 字典 completionStatuses）",
      completionStatusName: "完结状态当前名（读时 join，非快照）",
      processLogsText:
        "跟进记录拼接文本：仅 action=comment 行按 at 升序拼接，internalOnly 行包含在内；结构化日志走 /api/v1/process-logs",
      complaint_feedbackTime: "反馈时间（投诉侧表字段，非投诉单恒 null）",
      complaint_channelId: "渠道 id（见 meta 字典 channels）",
      complaint_channelName: "渠道当前名（读时 join，非快照）",
      complaint_project: "项目",
      complaint_brokerageEntity: "经纪主体",
      complaint_paymentChannel: "支付渠道",
      complaint_internalOrderNumber: "内部订单号",
      complaint_policyNumbers: "保单号数组",
      complaint_noPolicyNumber: "是否无保单号",
      complaint_userFeedbackChannelId: "用户反馈渠道 id（见 meta 字典 userFeedbackChannels）",
      complaint_userFeedbackChannelName: "用户反馈渠道当前名（读时 join，非快照）",
      complaint_feedbackReceiveChannelId:
        "反馈信息接收渠道 id（见 meta 字典 feedbackReceiveChannels）",
      complaint_feedbackReceiveChannelName: "反馈信息接收渠道当前名（读时 join，非快照）",
      complaint_customerName: "客户姓名",
      complaint_phone: "客户电话",
      complaint_customerRequest: "客户诉求",
      complaint_nuclearBodyStatus:
        "核身状态（见 meta complaint.nuclearBodyStatus；未知取值原样透传）",
      complaint_hasContacted: "是否已联系",
      complaint_contactTime: "进线时间",
      complaint_contactId: "联系 ID",
      complaint_categoryId: "客诉类别 id（见 meta 字典 categories）",
      complaint_categoryName: "客诉类别当前名（读时 join，非快照）",
      complaint_priority: "优先级（见 meta complaint.priority；未知取值原样透传）",
      refund_platform: "推送平台（退费侧表字段，非退费单恒 null）",
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
      refund_pushedFields: "平台推送实收字段清单",
      refund_compensationAmount: "补偿金（诚意金）",
    },
  },
  {
    path: "/api/v1/process-logs",
    summary: "处理日志流（at 倒序翻页 / updatedSince 增量同步双模式）",
    description:
      "全量 action 的处理日志（含 internalOnly=true 内部跟进，对齐内部导出口径）；父单软删后日志照常流出。" +
      "门禁 ticket.export；数据范围经 join 工单套用（无 ticket.view_all 仅见本人负责/创建工单的日志）。" +
      "缺省 ad-hoc 模式按 (at desc, id desc) 翻页；传 updatedSince 切增量模式，按 (at asc, id asc) 翻页。",
    query: openApiProcessLogsInputSchema,
    queryDescriptions: {
      ...PAGINATION_QUERY_DESCRIPTIONS,
      ticketId: "按所属工单 id 过滤（仍受 key 持有人的工单数据范围约束）",
      updatedSince:
        "传入即切增量同步模式：返回 at >= 该时刻的日志（含等于，ISO 8601 带时区），按 (at asc, id asc) 翻页",
    },
    response: openApiProcessLogListResponseSchema,
    responseDescriptions: {
      ...LIST_WRAPPER_DESCRIPTIONS,
      data: "本页日志行",
      id: "日志 ID",
      ticketId: "所属工单 ID",
      workOrderNumber: "所属工单号（读时 join 当前值）",
      action: "动作枚举原始值（见 meta processLog.action；未知取值原样透传）",
      operatorId: "操作人用户 id",
      operatorName: "操作人姓名快照",
      from: "变更前值（assign → 姓名快照，status_change → 状态枚举；其余动作为 null）",
      to: "变更后值（约定同 from）",
      remark: "备注 / 跟进正文",
      internalOnly: "仅内部可见标志；true 行照常流出，面向外部数据使用方的下游须自行过滤",
      at: "发生时刻；游标排序键",
    },
  },
  {
    path: "/api/v1/meta",
    summary: "机器可读数据字典（枚举 label / 增量契约 caveat / 目录快照）",
    description:
      "任意有效内部 key 可读（无 ticket.export 门槛）。枚举取值与中文 label、增量同步契约注意事项、" +
      "七类字典目录快照（id → 当前 name/active）。目录改名不产生增量事件，下游以 id 为键缓存、按需重拉本端点刷新 name 映射。",
    response: openApiMetaResponseSchema,
    responseDescriptions: {
      version: "服务版本（构建期注入的发布 tag）",
      spec: "OpenAPI 3.1 文档地址（公开，无需 key）",
      docs: "交互式文档地址（Scalar）",
      enums: "枚举值与中文 label 对照；键为 API 字段路径",
      "ticket.status": "工单存储基础状态",
      "ticket.displayStatus": "工单读时展示状态（存储态 + 计算态 pending_timeout/overdue）",
      "ticket.source": "工单来源",
      "complaint.priority": "投诉单优先级",
      "complaint.nuclearBodyStatus": "投诉单核身状态（中文枚举字面值即存储值）",
      "processLog.action": "处理日志动作",
      caveats: "契约注意事项：消费方接入前必读",
      contractEvolution: "契约演化承诺",
      incremental: "增量同步契约注意事项",
      dictionaries: "字典目录快照（id → 当前 name/active）",
      ticketKinds: "工单种类目录",
      channels: "反馈渠道目录",
      categories: "客诉类别目录",
      slaPolicies: "时效策略目录",
      completionStatuses: "完结状态目录",
      userFeedbackChannels: "用户反馈渠道目录",
      feedbackReceiveChannels: "反馈信息接收渠道目录",
      id: "目录行 id",
      key: "行为绑定 key（代码契约，创建后不可改）",
      name: "目录行当前名称",
      active: "是否启用（停用行退出录入下拉，存量引用照常显示）",
      kindId: "所属工单种类 id",
      value: "枚举原始值（存储/传输值）",
      label: "枚举中文 label",
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

function applyDescriptions(node: unknown, descriptions: Record<string, string>): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => applyDescriptions(item, descriptions));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "properties" && value !== null && typeof value === "object") {
      out[key] = Object.fromEntries(
        Object.entries(value as Json).map(([name, prop]) => [
          name,
          applyDescriptions(
            descriptions[name] !== undefined &&
              prop !== null &&
              typeof prop === "object" &&
              !Array.isArray(prop)
              ? { ...(prop as Json), description: descriptions[name] }
              : prop,
            descriptions,
          ),
        ]),
      );
    } else {
      out[key] = applyDescriptions(value, descriptions);
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
    "401": errorResponse("缺少或无效 API key（unauthorized）"),
    "403": errorResponse("key 不被允许（外部角色 key 或缺少 ticket.export；forbidden）"),
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
    "认证：Authorization: Bearer sk_…（持有人的机器化身，权限与数据范围同人）；外部角色 key 一律 403。限流：每 key 令牌桶 burst 20 + 2 次/秒回填（稳态 ≈120 次/分钟）；无效 key 探测另按来源 IP 限流 20 次/分钟，锁定期间同 IP 的有效 key 一并 429（fail-closed）。超限 429 + Retry-After。错误一律 { error: { code, message } } 信封；带 query 的端点拒绝本文档未列出的参数（400 invalid_params，拼错的参数名不会静默生效）。",
    "分页：keyset 游标——响应带 nextCursor/nextUrl，原样回传 cursor 续翻到底；游标钉死签发时的模式与筛选集，混用报 invalid_cursor。",
    OPEN_API_CONTRACT_EVOLUTION,
    `增量同步契约注意事项：\n${OPEN_API_INCREMENTAL_CAVEATS.map((caveat, index) => `${index + 1}. ${caveat}`).join("\n")}`,
  ].join("\n\n");

  return {
    openapi: "3.1.0",
    info: {
      title: "InsureDesk Open API",
      version: env.APP_VERSION,
      description: infoDescription,
    },
    paths: Object.fromEntries(ENDPOINTS.map((spec) => [spec.path, { get: buildOperation(spec) }])),
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}
