import type { ComplaintLevel, NuclearBodyStatus, Priority } from "@insuredesk/shared";
import {
  COMPLAINT_LEVELS,
  joinPolicyNumbers,
  NUCLEAR_BODY_STATUSES,
  PRIORITY_LABELS,
  TICKET_FIELDS,
  type TicketCreateFieldKey,
  type TicketFieldOverrides,
} from "@insuredesk/shared";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  type CurrentCatalogOption,
  HAS_CONTACTED_OPTIONS,
  type TicketFormValues,
  UNSET,
  withCurrentOption,
} from "./TicketFormFields";

/**
 * 详情/编辑双模式字段渲染器：同一个单元格按模式渲染——只读渲染值、编辑渲染
 * 控件，标签与栅格位置两态一致，原地编辑时字段不挪位。编辑态被用户改动过的
 * 字段在标签后带「已修改」高亮（调用方按 react-hook-form dirtyFields 传入），
 * 取消/保存后随模式退出消失。系统/SLA 字段不走这里，仍用详情弹窗的 Item。
 *
 * 目录下拉只列启用项；工单当前值若已停用，以「（已停用）」入列保持原值合法。
 * 校验与取值契约沿用建单的 ticketFormSchema —— 服务端解析的同一份 schema。
 */

/** The editable slice of the detail payload the edit mode prefills from. */
export interface EditableTicket {
  id: string;
  workOrderNumber: string;
  feedbackTime: string | null;
  channel: CurrentCatalogOption | null;
  project: string | null;
  brokerageEntity: string | null;
  paymentChannel: string | null;
  internalOrderNumber: string | null;
  policyNumbers: string[];
  userComplaintChannel: string | null;
  complaintReceiveChannel: string | null;
  customerName: string | null;
  phone: string | null;
  contactPhone: string | null;
  customerRequest: string | null;
  nuclearBodyStatus: NuclearBodyStatus | null;
  hasContacted: boolean | null;
  contactTime: string | null;
  contactId: string | null;
  category: CurrentCatalogOption | null;
  complaintLevel: ComplaintLevel | null;
  priority: Priority | null;
}

/**
 * Detail wire values → form values: ISO instant to local partial, null to "".
 * null ticket = the pre-load blank shape, so the form can be constructed before
 * the detail query resolves (the real prefill lands via reset on 编辑).
 */
export function formDefaults(ticket: EditableTicket | null): TicketFormValues {
  return {
    feedbackTime: ticket?.feedbackTime
      ? format(new Date(ticket.feedbackTime), "yyyy-MM-dd'T'HH:mm")
      : "",
    channelId: ticket?.channel?.id ?? "",
    project: ticket?.project ?? "",
    brokerageEntity: ticket?.brokerageEntity ?? "",
    paymentChannel: ticket?.paymentChannel ?? "",
    internalOrderNumber: ticket?.internalOrderNumber ?? "",
    policyNumbers: joinPolicyNumbers(ticket?.policyNumbers ?? []),
    userComplaintChannel: ticket?.userComplaintChannel ?? "",
    complaintReceiveChannel: ticket?.complaintReceiveChannel ?? "",
    customerName: ticket?.customerName ?? "",
    phone: ticket?.phone ?? "",
    contactPhone: ticket?.contactPhone ?? "",
    customerRequest: ticket?.customerRequest ?? "",
    nuclearBodyStatus: ticket?.nuclearBodyStatus ?? "",
    hasContacted: ticket?.hasContacted ?? null,
    contactTime: ticket?.contactTime
      ? format(new Date(ticket.contactTime), "yyyy-MM-dd'T'HH:mm")
      : "",
    contactId: ticket?.contactId ?? "",
    categoryId: ticket?.category?.id ?? "",
    complaintLevel: ticket?.complaintLevel ?? "",
    priority: ticket?.priority ?? "",
  };
}

function readValue(name: TicketCreateFieldKey, ticket: EditableTicket): ReactNode {
  switch (name) {
    case "feedbackTime":
      return formatDateTime(ticket.feedbackTime);
    case "contactTime":
      return formatDateTime(ticket.contactTime);
    case "channelId":
      return ticket.channel?.name ?? null;
    case "categoryId":
      return ticket.category?.name ?? null;
    case "hasContacted":
      return (
        TICKET_FIELDS.hasContacted.options.find((option) => option.value === ticket.hasContacted)
          ?.label ?? null
      );
    case "priority":
      return ticket.priority ? PRIORITY_LABELS[ticket.priority] : null;
    case "customerRequest":
      return <span className="whitespace-pre-wrap">{ticket.customerRequest}</span>;
    case "policyNumbers":
      // [] = 未填写，交给调用方的 "—" 兜底
      return ticket.policyNumbers.length > 0 ? joinPolicyNumbers(ticket.policyNumbers) : null;
    case "nuclearBodyStatus":
    case "complaintLevel":
    case "project":
    case "brokerageEntity":
    case "paymentChannel":
    case "internalOrderNumber":
    case "userComplaintChannel":
    case "complaintReceiveChannel":
    case "customerName":
    case "phone":
    case "contactPhone":
    case "contactId":
      return ticket[name];
  }
}

function EnumControl({
  form,
  name,
  options,
  invalid,
}: {
  form: UseFormReturn<TicketFormValues>;
  name: "nuclearBodyStatus" | "complaintLevel" | "priority";
  options: ReadonlyArray<{ value: string; label: string }>;
  invalid: boolean;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value ? field.value : UNSET}
          onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
        >
          <SelectTrigger id={name} className="w-full" aria-invalid={invalid}>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={UNSET}>未设置</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    />
  );
}

function CatalogControl({
  form,
  name,
  current,
  invalid,
}: {
  form: UseFormReturn<TicketFormValues>;
  name: "channelId" | "categoryId";
  current: CurrentCatalogOption | null;
  invalid: boolean;
}) {
  const channelOptions = trpc.channel.options.useQuery(undefined, {
    enabled: name === "channelId",
  });
  const categoryOptions = trpc.ticketCategory.options.useQuery(undefined, {
    enabled: name === "categoryId",
  });
  const options = withCurrentOption(
    (name === "channelId" ? channelOptions.data : categoryOptions.data) ?? [],
    current,
  );

  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value ? field.value : UNSET}
          onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
        >
          <SelectTrigger id={name} className="w-full" aria-invalid={invalid}>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={UNSET}>未设置</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    />
  );
}

function EditControl({
  name,
  ticket,
  form,
  invalid,
}: {
  name: TicketCreateFieldKey;
  ticket: EditableTicket;
  form: UseFormReturn<TicketFormValues>;
  invalid: boolean;
}) {
  const { register, control } = form;
  switch (name) {
    case "feedbackTime":
    case "contactTime":
      return (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <DateTimePicker
              id={name}
              value={field.value}
              onChange={field.onChange}
              datePickerAriaLabel={`${TICKET_FIELDS[name].label}的日期选择器`}
              timeAriaLabel={`${TICKET_FIELDS[name].label}的时分`}
              invalid={invalid}
            />
          )}
        />
      );
    case "channelId":
      return <CatalogControl form={form} name={name} current={ticket.channel} invalid={invalid} />;
    case "categoryId":
      return <CatalogControl form={form} name={name} current={ticket.category} invalid={invalid} />;
    case "nuclearBodyStatus":
      return (
        <EnumControl
          form={form}
          name={name}
          options={NUCLEAR_BODY_STATUSES.map((status) => ({ value: status, label: status }))}
          invalid={invalid}
        />
      );
    case "complaintLevel":
      return (
        <EnumControl
          form={form}
          name={name}
          options={COMPLAINT_LEVELS.map((level) => ({ value: level, label: level }))}
          invalid={invalid}
        />
      );
    case "priority":
      return (
        <EnumControl
          form={form}
          name={name}
          options={TICKET_FIELDS.priority.options.map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
          invalid={invalid}
        />
      );
    case "hasContacted":
      return (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Select
              value={field.value === true ? "yes" : field.value === false ? "no" : UNSET}
              onValueChange={(value) => field.onChange(value === UNSET ? null : value === "yes")}
            >
              <SelectTrigger id={name} className="w-full" aria-invalid={invalid}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={UNSET}>未设置</SelectItem>
                  {HAS_CONTACTED_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />
      );
    case "customerRequest":
      return <Textarea id={name} rows={4} aria-invalid={invalid} {...register(name)} />;
    case "phone":
    case "contactPhone":
      return <Input id={name} type="tel" aria-invalid={invalid} {...register(name)} />;
    default:
      return <Input id={name} aria-invalid={invalid} {...register(name)} />;
  }
}

export function TicketDetailField({
  name,
  ticket,
  editing,
  form,
  dirty,
  error,
}: {
  name: TicketCreateFieldKey;
  ticket: EditableTicket;
  editing: boolean;
  form: UseFormReturn<TicketFormValues>;
  /** 编辑态被用户改动过 → 标签后带「已修改」高亮。 */
  dirty: boolean;
  error?: string;
}) {
  const descriptor = TICKET_FIELDS[name];
  const overrides: TicketFieldOverrides | undefined =
    "overrides" in descriptor ? descriptor.overrides : undefined;
  const label = overrides?.detailLabel ?? descriptor.label;
  // DateTimePicker 的可聚焦主控件是日期输入框
  const controlId = descriptor.type === "date" ? `${name}-date` : name;

  return (
    <div className="flex flex-col gap-0.5">
      <dt className={cn("text-xs text-muted-foreground", editing && "flex items-center gap-1.5")}>
        {editing ? <label htmlFor={controlId}>{label}</label> : label}
        {editing && dirty && (
          <span className="rounded-sm bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            已修改
          </span>
        )}
      </dt>
      <dd className="m-0 text-sm">
        {editing ? (
          <div className="flex flex-col gap-1">
            <EditControl name={name} ticket={ticket} form={form} invalid={!!error} />
            {error && <p className="m-0 text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          (readValue(name, ticket) ?? "—")
        )}
      </dd>
    </div>
  );
}
