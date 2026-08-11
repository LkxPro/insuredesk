import { DetailGrid, DetailItem } from "@/pages/tickets/DetailGrid";
import {
  EXTERNAL_DETAIL_FIELD_ORDER,
  type ExternalTicket,
  externalFieldLabel,
  externalFieldValue,
} from "./external-ticket-fields";

/**
 * 外部详情的左栏：工单原文置顶直出（左栏常只剩它一个内容，折叠起来就只剩
 * 空栏，且原文是提交者自己贴的、没有剧透可言），下面全部建单字段按"有值即
 * 渲染"平铺（取词取值走 external-ticket-fields），与内部详情左栏共用
 * DetailGrid 栅格原语。平铺不分区：字段全量出线，固定分区无意义。
 *
 * 工单号与状态不渲染——它们已挂在详情头部，重复一遍白占一格（同内部左栏的
 * 取舍）。整栏无值时给出提示：字段是客服后补的元数据，空是常态。
 */

/** 头部已承载的身份字段，不进字段栅格。 */
const HEADER_KEYS = new Set(["workOrderNumber", "status"]);

export function ExternalTicketInfoColumn({ ticket }: { ticket: ExternalTicket }) {
  const filled = EXTERNAL_DETAIL_FIELD_ORDER.filter((key) => !HEADER_KEYS.has(key))
    .map((key) => ({ key, value: externalFieldValue(ticket, key) }))
    .filter((entry) => entry.value !== null && entry.value !== "");

  return (
    <div className="flex flex-col gap-6">
      {ticket.submissionText && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <h3 className="m-0 text-sm font-medium text-muted-foreground">工单原文</h3>
          <pre className="m-0 whitespace-pre-wrap text-sm">{ticket.submissionText}</pre>
        </div>
      )}
      {filled.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">客服团队还未补充工单信息。</p>
      ) : (
        <DetailGrid>
          {filled.map(({ key, value }) => (
            <DetailItem key={key} label={externalFieldLabel(key)}>
              {value}
            </DetailItem>
          ))}
        </DetailGrid>
      )}
    </div>
  );
}
