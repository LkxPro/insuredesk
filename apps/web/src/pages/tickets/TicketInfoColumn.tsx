import { TICKET_FIELDS, TICKET_SOURCE_LABELS, type TicketCreateFieldKey } from "@insuredesk/shared";
import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { formatDateTime } from "@/lib/datetime";
import { DetailItem as Item, DetailSection as Section } from "@/pages/ticket-surface/DetailGrid";
import { StatusBadge } from "@/pages/ticket-surface/StatusBadge";
import { SubmissionTextCollapse } from "./SubmissionTextCollapse";
import { TicketDetailField } from "./TicketDetailFields";
import type { TicketFormValues } from "./TicketFormFields";
import type { TicketDetail } from "./ticket-detail";

/**
 * 分栏详情的左栏：整单的工单信息字段，只读态渲染值、编辑态原位变控件（由
 * TicketDetailField 双模式渲染）。系统字段（工单号/创建时间/来源/创建人）与
 * SLA 派生字段（处理时限/首响/跟进频次/联系次数…）两态都是只读文本——它们不
 * 是可编辑字段集的成员，编辑态也不长出控件。
 *
 * 只负责呈现字段。头部操作、编辑态的表单容器与保存/取消都在 TicketDetailPane。
 * 栅格原语（Section/Item）与外部详情左栏共用 DetailGrid.tsx。
 */

export function TicketInfoColumn({
  ticket,
  editing,
  form,
  fieldAddon,
}: {
  ticket: TicketDetail;
  editing: boolean;
  form: UseFormReturn<TicketFormValues>;
  /** 编辑态查重命中提示，仅保单号/手机号三个字段会拿到内容。 */
  fieldAddon?: (name: TicketCreateFieldKey) => ReactNode;
}) {
  const { dirtyFields, errors } = form.formState;
  const field = (name: TicketCreateFieldKey) => (
    <TicketDetailField
      name={name}
      ticket={ticket}
      editing={editing}
      form={form}
      dirty={!!dirtyFields[name]}
      error={errors[name]?.message}
      addon={fieldAddon?.(name)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* 工单号不在这里：头部已经挂着它，重复一遍白占一格 */}
      <Section title="基本信息">
        <Item label="创建时间">{formatDateTime(ticket.createdAt)}</Item>
        <Item label="更新时间">{formatDateTime(ticket.updatedAt)}</Item>
        {field("feedbackTime")}
        <Item label="工单来源">{TICKET_SOURCE_LABELS[ticket.source]}</Item>
        <Item label="创建人">{ticket.createdBy}</Item>
      </Section>

      <Section title="业务信息">
        {field("channelId")}
        {field("project")}
        {field("brokerageEntity")}
        {field("paymentChannel")}
        {field("internalOrderNumber")}
        {field("policyNumbers")}
        {field("userComplaintChannel")}
        {field("complaintReceiveChannel")}
      </Section>

      <Section title="客户信息">
        {field("customerName")}
        {field("phone")}
        {field("contactPhone")}
        {field("nuclearBodyStatus")}
        {field("hasContacted")}
        {field("contactTime")}
        {field("contactId")}
        <div className="sm:col-span-2 xl:col-span-3">{field("customerRequest")}</div>
      </Section>

      {!editing &&
        ticket.source === "external_channel" &&
        ticket.submissionText != null &&
        ticket.submissionText !== "" && <SubmissionTextCollapse text={ticket.submissionText} />}

      <Section title="分类与等级">
        {field("categoryId")}
        {field("complaintLevel")}
        {field("priority")}
        <Item label="跟进频次要求">{ticket.followUpFrequency}</Item>
        <Item label="首响要求">{ticket.firstResponseRequirement}</Item>
      </Section>

      <Section title="处理状态">
        <Item label="工单状态">
          <StatusBadge status={ticket.displayStatus} />
        </Item>
        <Item label="责任人">{ticket.assigneeName}</Item>
        <Item label="分配时间">{formatDateTime(ticket.assignedAt)}</Item>
        <Item label="处理时限">
          {/* dueAt null means 特急 (不设时限) when a level exists, 未定级 otherwise */}
          {ticket.dueAt
            ? formatDateTime(ticket.dueAt)
            : ticket.complaintLevel
              ? "不设时限（特急）"
              : null}
        </Item>
        <Item label="下次联系时间">{formatDateTime(ticket.nextContactTime)}</Item>
        <Item label="联系次数">{ticket.contactCount}</Item>
      </Section>

      {(ticket.completionTime || ticket.completionStatus) && (
        <Section title="完结信息">
          <Item label="完结时间">{formatDateTime(ticket.completionTime)}</Item>
          <Item label={TICKET_FIELDS.completionStatusId.label}>{ticket.completionStatus}</Item>
        </Section>
      )}
    </div>
  );
}
