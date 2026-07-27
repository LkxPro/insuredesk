import type { AppRouter } from "@insuredesk/api";
import {
  PRIORITY_LABELS,
  TICKET_FIELD_DESCRIPTORS,
  TICKET_FIELDS,
  type TicketFieldOverrides,
} from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/datetime";
import { StatusBadge } from "@/pages/tickets/StatusBadge";

/**
 * 外部工单字段的取词与取值：列表列头、详情卡片、空值判定共用这一份，两个页面
 * 不各自维护 label 表。可见字段白名单里除建单字段外还有三个系统字段
 * （工单号/状态/最新跟进），它们不在 TICKET_FIELDS 里，标签在这里补齐。
 */

export type ExternalTicket =
  inferRouterOutputs<AppRouter>["externalTicket"]["list"]["items"][number];

/** 详情响应里的一条处理记录。 */
export type ExternalProcessLog =
  inferRouterOutputs<AppRouter>["externalTicket"]["detail"]["processLogs"][number];

/** 白名单里不属于建单字段的系统字段标签。 */
const SYSTEM_FIELD_LABELS: Record<string, string> = {
  workOrderNumber: "工单号",
  status: "状态",
  processingResult: "最新跟进",
};

/**
 * 详情页字段顺序：TICKET_FIELDS 声明顺序，系统字段按其语义就位——工单号与
 * 状态是工单的身份与当前进展，排在业务字段之前；最新跟进是处理结果，收尾。
 */
export const EXTERNAL_DETAIL_FIELD_ORDER: readonly string[] = [
  "workOrderNumber",
  "status",
  ...TICKET_FIELD_DESCRIPTORS.map((descriptor) => descriptor.key),
  "processingResult",
];

function overridesOf(key: string): TicketFieldOverrides | undefined {
  const descriptor = TICKET_FIELDS[key as keyof typeof TICKET_FIELDS];
  return descriptor && "overrides" in descriptor ? descriptor.overrides : undefined;
}

/** 列表列头/详情标题取词；表面各自的 override 优先，缺省用标准名。 */
export function externalFieldLabel(key: string, surface: "listLabel" | "detailLabel"): string {
  const descriptor = TICKET_FIELDS[key as keyof typeof TICKET_FIELDS];
  if (!descriptor) {
    return SYSTEM_FIELD_LABELS[key] ?? key;
  }
  return overridesOf(key)?.[surface] ?? descriptor.label;
}

/**
 * 字段取值。目录引用取 JOIN 出的名字（外部方读不到目录），日期与枚举按各表面
 * 统一的格式化，状态走共用的 StatusBadge。返回 null = 未填写，由调用方决定
 * 显示成 — 还是整条不渲染。
 */
export function externalFieldValue(ticket: ExternalTicket, key: string): ReactNode {
  switch (key) {
    case "workOrderNumber":
      return ticket.workOrderNumber;
    case "status":
      return <StatusBadge status={ticket.status} />;
    case "feedbackTime":
      return ticket.feedbackTime ? formatDateTime(ticket.feedbackTime) : null;
    case "contactTime":
      return ticket.contactTime ? formatDateTime(ticket.contactTime) : null;
    case "channelId":
      return ticket.channelName;
    case "categoryId":
      return ticket.categoryName;
    case "completionStatusId":
      return ticket.completionStatusName;
    case "completionRemark":
      // 完结备注落在 resolve 的处理记录里，时间线已呈现，卡片不重复
      return null;
    case "hasContacted":
      return ticket.hasContacted === null ? null : ticket.hasContacted ? "是" : "否";
    case "priority":
      return ticket.priority ? PRIORITY_LABELS[ticket.priority] : null;
    case "project":
      return ticket.project;
    case "brokerageEntity":
      return ticket.brokerageEntity;
    case "paymentChannel":
      return ticket.paymentChannel;
    case "userComplaintChannel":
      return ticket.userComplaintChannel;
    case "complaintReceiveChannel":
      return ticket.complaintReceiveChannel;
    case "nuclearBodyStatus":
      return ticket.nuclearBodyStatus;
    case "customerRequest":
      return ticket.customerRequest;
    case "complaintLevel":
      return ticket.complaintLevel;
    case "processingResult":
      return ticket.processingResult || null;
    default:
      // 敏感字段与未知 key 不在外部 wire shape 里，一律无值
      return null;
  }
}
