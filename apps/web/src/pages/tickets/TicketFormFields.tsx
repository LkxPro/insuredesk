import {
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  policyNumbersError,
  splitPolicyNumbers,
  TICKET_CREATE_FIELD_KEYS,
  TICKET_FIELDS,
  type TicketCreateFieldKey,
  type TicketCreateInput,
  ticketCreateInputSchema,
} from "@insuredesk/shared";
import { CheckIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { Controller, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
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
import { useAuth } from "@/contexts/AuthContext";
import {
  isCompleteLocalDate,
  isCompleteLocalDateTime,
  isCompleteLocalTime,
  localDateTimeToIso,
  splitLocalDateTime,
} from "@/lib/local-date-time";
import { trpc } from "@/lib/trpc";
import { DuplicateFieldHint, useTicketDuplicates } from "./TicketDuplicates";

/**
 * The 建单 form body: the field set of 新建工单. 详情弹窗的原地编辑不走这里 ——
 * 同一批字段在详情分区里由 TicketDetailFields 按原位渲染。
 *
 * Every field is optional: a fully blank form submits cleanly and unfilled
 * fields reach the server as null. No label says 选填 — optional is the rule,
 * not the exception. Validation is the shared ticketCreateInputSchema — the
 * contract the API parses — with one form-side deviation: datetime fields are
 * held as local datetime strings ("" = unfilled) until submit, when the
 * caller converts them to absolute instants or null.
 *
 * 动态必填：建单表单据用户角色的必填集生成校验。必填字段标签后显示星号。
 */
export function buildTicketFormSchema(requiredFields: readonly string[]) {
  let schema = ticketFormSchema;

  const requiredExtension: Record<string, z.ZodTypeAny> = {};
  for (const key of TICKET_CREATE_FIELD_KEYS) {
    // 保单号的必填判定在对象级（勾选「无保单号」算明确表态）
    if (requiredFields.includes(key) && key !== "policyNumbers") {
      requiredExtension[key] = requiredFieldSchema(TICKET_FIELDS[key]);
    }
  }

  if (Object.keys(requiredExtension).length > 0) {
    schema = schema.extend(requiredExtension) as typeof schema;
  }

  return schema.superRefine((values, ctx) => {
    if (
      requiredFields.includes("policyNumbers") &&
      values.noPolicyNumber !== true &&
      !values.policyNumbers?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyNumbers"],
        message: `${TICKET_FIELDS.policyNumbers.label}为必填项`,
      });
    }
  });
}

/** 类型错误也用必填句——未触碰的下拉提交时是 undefined，不能落到 zod 默认英文文案。 */
function requiredFieldSchema(descriptor: (typeof TICKET_FIELDS)[TicketCreateFieldKey]) {
  const message = `${descriptor.label}为必填项`;
  switch (descriptor.type) {
    case "text":
      return z.string(message).trim().min(1, message).max(descriptor.maxLength);
    case "textList":
      // 必填＝至少一个值；单项长度/数量上限与非必填形态同一套 refinement
      return z.string(message).trim().min(1, message).superRefine(refinePolicyNumbersText);
    case "enum":
      // 布尔取值的三态字段（客户曾进线）在表单里就是 boolean|null
      return typeof descriptor.options[0]?.value === "boolean"
        ? z.boolean({ error: message })
        : z.string(message).min(1, message);
    case "date":
      return localDateTimeFieldSchema(descriptor.label, true);
    case "catalog":
      // catalog 在表单里是目录 id
      return z.string(message).min(1, message);
  }
}

/**
 * Empty is valid for optional datetime fields. Once either half is present,
 * both date and minute must be present before the form can submit.
 */
function localDateTimeFieldSchema(label: string, required: boolean) {
  return z.string().superRefine((value, ctx) => {
    if (!value) {
      if (required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}为必填项` });
      }
      return;
    }
    const { date, time } = splitLocalDateTime(value);
    if (date && !isCompleteLocalDate(date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label}日期格式不正确，请按 YY-MM-DD 输入`,
      });
      return;
    }
    if (time && !isCompleteLocalTime(time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label}时间格式不正确`,
      });
      return;
    }
    if (!isCompleteLocalDateTime(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label}需同时选择日期和时间`,
      });
    }
  });
}

/**
 * 表单以空格分隔字符串承载多值保单号（split 在提交映射里做，与日期字段的
 * localDateTimeToIso 同位）；上限校验即数组契约那一套，报错文案不另抄。
 */
const refinePolicyNumbersText = (value: string, ctx: z.RefinementCtx) => {
  const error = policyNumbersError(splitPolicyNumbers(value));
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
};

export const ticketFormSchema = ticketCreateInputSchema.extend({
  feedbackTime: localDateTimeFieldSchema(TICKET_FIELDS.feedbackTime.label, false),
  contactTime: localDateTimeFieldSchema(TICKET_FIELDS.contactTime.label, false),
  policyNumbers: z.string().superRefine(refinePolicyNumbersText),
});

export type TicketFormValues = z.input<typeof ticketFormSchema>;

/**
 * Form values → wire payload：日期字段本地时间转绝对时刻，保单号空格分隔
 * 文本 split 成数组。建单与详情编辑的提交映射共用这一处。
 */
export function ticketFormValuesToInput(values: TicketFormValues): TicketCreateInput {
  return {
    ...values,
    feedbackTime: localDateTimeToIso(values.feedbackTime),
    contactTime: localDateTimeToIso(values.contactTime),
    policyNumbers: splitPolicyNumbers(values.policyNumbers),
  };
}

/** Radix Select forbids `value=""` items; stand-in for the "未设置" choice. */
export const UNSET = "__unset__";

/**
 * 「无保单号」勾选框：无 = 明确没有保单号（与留空未填写不同）；
 * 取消勾选不恢复已清空的原文。
 */
export function PolicyNumbersControl({
  form,
  invalid,
}: {
  form: UseFormReturn<TicketFormValues>;
  invalid: boolean;
}) {
  const none = form.watch("noPolicyNumber") === true;
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        id="policyNumbers"
        aria-invalid={invalid}
        disabled={none}
        {...form.register("policyNumbers")}
      />
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 渲染为 button（可标签元素），整行点击经 label 激活它；biome 只认原生 input */}
      <label className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
        <Checkbox
          checked={none}
          onCheckedChange={(checked) => {
            const next = checked === true;
            form.setValue("noPolicyNumber", next, { shouldDirty: true });
            if (next) {
              form.setValue("policyNumbers", "", { shouldDirty: true });
            }
          }}
        />
        无保单号
      </label>
    </div>
  );
}

/** hasContacted is tri-state (是/否/未知) — a checkbox can't say "unknown". Radix 不收布尔 value，转码为哨兵串。 */
export const HAS_CONTACTED_OPTIONS = TICKET_FIELDS.hasContacted.options.map((option) => ({
  value: option.value ? "yes" : "no",
  label: option.label,
}));

/** The edit form's current catalog value — kept selectable even after 停用. */
export interface CurrentCatalogOption {
  id: string;
  name: string;
  active: boolean;
}

/**
 * The dropdown feed lists ACTIVE catalog rows only; a ticket already holding a
 * since-停用 value keeps it as an extra labelled option, so "保持原值" works
 * while other disabled rows stay unselectable.
 */
export function withCurrentOption(
  options: ReadonlyArray<{ id: string; name: string }>,
  current: CurrentCatalogOption | null | undefined,
) {
  if (!current || options.some((option) => option.id === current.id)) {
    return options;
  }
  return [
    ...options,
    { id: current.id, name: current.active ? current.name : `${current.name}（已停用）` },
  ];
}

/**
 * 时效策略下拉项：名称为主、说明小字随行。说明不进 ItemText——触发器回显只有
 * 名称一行；小字只在展开的选项列表里（内部选型控件的统一口径）。
 */
export function SlaPolicyOptionItem({
  option,
}: {
  option: { id: string; name: string; description?: string | null };
}) {
  return (
    <SelectPrimitive.Item
      value={option.id}
      className="relative flex w-full cursor-default flex-col items-start gap-0.5 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
      <span
        data-slot="select-item-indicator"
        className="absolute top-1.5 right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>
        <span>{option.name}</span>
      </SelectPrimitive.ItemText>
      {option.description ? (
        <span className="text-xs text-muted-foreground">{option.description}</span>
      ) : null}
    </SelectPrimitive.Item>
  );
}

export function SlaPolicySelect({
  id,
  value,
  onChange,
  invalid,
  current,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** 编辑表单传入工单当前策略；建单不传。 */
  current?: CurrentCatalogOption | null;
}) {
  const options = withCurrentOption(trpc.sla.options.useQuery().data ?? [], current);
  return (
    <Select
      value={value ? value : UNSET}
      onValueChange={(next) => onChange(next === UNSET ? "" : next)}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder="请选择" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={UNSET}>未设置</SelectItem>
          {options.map((option) => (
            <SlaPolicyOptionItem key={option.id} option={option} />
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function TicketFormFields({
  form,
  currentCategory,
  currentChannel,
}: {
  form: UseFormReturn<TicketFormValues>;
  /** 编辑表单传入工单当前类别；停用值以“（已停用）”入列，保持原值合法。 */
  currentCategory?: CurrentCatalogOption | null;
  /** 同 currentCategory，作用于反馈渠道。 */
  currentChannel?: CurrentCatalogOption | null;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;

  const { user } = useAuth();
  const requiredFields = new Set(user?.requiredTicketFields ?? []);

  const isRequired = (field: TicketCreateFieldKey) => requiredFields.has(field);

  const selectableCategories = withCurrentOption(
    trpc.ticketCategory.options.useQuery().data ?? [],
    currentCategory,
  );
  const selectableChannels = withCurrentOption(
    trpc.channel.options.useQuery().data ?? [],
    currentChannel,
  );
  const userComplaintChannelOptions = trpc.userComplaintChannel.options.useQuery().data ?? [];
  const complaintReceiveChannelOptions = trpc.complaintReceiveChannel.options.useQuery().data ?? [];

  // 建单即时查重：命中提示贴身挂在保单号/手机号字段下（编辑面走 TicketDetailField 的 addon）
  const duplicates = useTicketDuplicates(form);

  return (
    <>
      <FieldSet>
        <FieldLegend variant="label">来源与渠道</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.feedbackTime}>
            <FieldLabel htmlFor="feedbackTime-date">
              {TICKET_FIELDS.feedbackTime.label}
              {isRequired("feedbackTime") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="feedbackTime"
              render={({ field }) => (
                <DateTimePicker
                  id="feedbackTime"
                  value={field.value}
                  onChange={field.onChange}
                  datePickerAriaLabel={`${TICKET_FIELDS.feedbackTime.label}的日期选择器`}
                  timeAriaLabel={`${TICKET_FIELDS.feedbackTime.label}的时分`}
                  invalid={!!errors.feedbackTime}
                />
              )}
            />
            <FieldError errors={[errors.feedbackTime]} />
          </Field>
          <Field data-invalid={!!errors.channelId}>
            <FieldLabel htmlFor="channelId">
              {TICKET_FIELDS.channelId.label}
              {isRequired("channelId") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="channelId"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger
                    id="channelId"
                    className="w-full"
                    aria-invalid={!!errors.channelId}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {selectableChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.channelId]} />
          </Field>
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">业务信息</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.project}>
            <FieldLabel htmlFor="project">
              {TICKET_FIELDS.project.label}
              {isRequired("project") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="project"
              placeholder="如：融盛、泰康（填写简称即可）"
              aria-invalid={!!errors.project}
              {...register("project")}
            />
            <FieldError errors={[errors.project]} />
          </Field>
          <Field data-invalid={!!errors.brokerageEntity}>
            <FieldLabel htmlFor="brokerageEntity">
              {TICKET_FIELDS.brokerageEntity.label}
              {isRequired("brokerageEntity") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="brokerageEntity"
              placeholder="如：凯森、东方大地（填写简称即可）"
              aria-invalid={!!errors.brokerageEntity}
              {...register("brokerageEntity")}
            />
            <FieldError errors={[errors.brokerageEntity]} />
          </Field>
          <Field data-invalid={!!errors.paymentChannel}>
            <FieldLabel htmlFor="paymentChannel">
              {TICKET_FIELDS.paymentChannel.label}
              {isRequired("paymentChannel") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="paymentChannel"
              placeholder="如：连连、银商、易宝、京东"
              aria-invalid={!!errors.paymentChannel}
              {...register("paymentChannel")}
            />
            <FieldError errors={[errors.paymentChannel]} />
          </Field>
          <Field data-invalid={!!errors.internalOrderNumber}>
            <FieldLabel htmlFor="internalOrderNumber">
              {TICKET_FIELDS.internalOrderNumber.label}
              {isRequired("internalOrderNumber") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="internalOrderNumber"
              aria-invalid={!!errors.internalOrderNumber}
              {...register("internalOrderNumber")}
            />
            <FieldError errors={[errors.internalOrderNumber]} />
          </Field>
          <Field data-invalid={!!errors.policyNumbers}>
            <FieldLabel htmlFor="policyNumbers">
              {TICKET_FIELDS.policyNumbers.label}
              {isRequired("policyNumbers") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <PolicyNumbersControl form={form} invalid={!!errors.policyNumbers} />
            <FieldError errors={[errors.policyNumbers]} />
            <DuplicateFieldHint field="policyNumbers" duplicates={duplicates} />
          </Field>
          <Field data-invalid={!!errors.userComplaintChannelId}>
            <FieldLabel htmlFor="userComplaintChannelId">
              {TICKET_FIELDS.userComplaintChannelId.label}
              {isRequired("userComplaintChannelId") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="userComplaintChannelId"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger
                    id="userComplaintChannelId"
                    className="w-full"
                    aria-invalid={!!errors.userComplaintChannelId}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {userComplaintChannelOptions.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.userComplaintChannelId]} />
          </Field>
          <Field data-invalid={!!errors.complaintReceiveChannelId}>
            <FieldLabel htmlFor="complaintReceiveChannelId">
              {TICKET_FIELDS.complaintReceiveChannelId.label}
              {isRequired("complaintReceiveChannelId") && (
                <span className="text-destructive">*</span>
              )}
            </FieldLabel>
            <Controller
              control={control}
              name="complaintReceiveChannelId"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger
                    id="complaintReceiveChannelId"
                    className="w-full"
                    aria-invalid={!!errors.complaintReceiveChannelId}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {complaintReceiveChannelOptions.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.complaintReceiveChannelId]} />
          </Field>
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">客户信息</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.customerName}>
            <FieldLabel htmlFor="customerName">
              {TICKET_FIELDS.customerName.label}
              {isRequired("customerName") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="customerName"
              aria-invalid={!!errors.customerName}
              {...register("customerName")}
            />
            <FieldError errors={[errors.customerName]} />
          </Field>
          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">
              {TICKET_FIELDS.phone.label}
              {isRequired("phone") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input id="phone" type="tel" aria-invalid={!!errors.phone} {...register("phone")} />
            <FieldError errors={[errors.phone]} />
            <DuplicateFieldHint field="phone" duplicates={duplicates} />
          </Field>
          <Field data-invalid={!!errors.contactPhone}>
            <FieldLabel htmlFor="contactPhone">
              {TICKET_FIELDS.contactPhone.label}
              {isRequired("contactPhone") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="contactPhone"
              type="tel"
              aria-invalid={!!errors.contactPhone}
              {...register("contactPhone")}
            />
            <FieldError errors={[errors.contactPhone]} />
            <DuplicateFieldHint field="contactPhone" duplicates={duplicates} />
          </Field>
          <Field data-invalid={!!errors.nuclearBodyStatus}>
            <FieldLabel htmlFor="nuclearBodyStatus">
              {TICKET_FIELDS.nuclearBodyStatus.label}
              {isRequired("nuclearBodyStatus") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="nuclearBodyStatus"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger
                    id="nuclearBodyStatus"
                    className="w-full"
                    aria-invalid={!!errors.nuclearBodyStatus}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {NUCLEAR_BODY_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.nuclearBodyStatus]} />
          </Field>
          <Field data-invalid={!!errors.customerRequest} className="sm:col-span-2">
            <FieldLabel htmlFor="customerRequest">
              {TICKET_FIELDS.customerRequest.label}
              {isRequired("customerRequest") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Textarea
              id="customerRequest"
              rows={4}
              aria-invalid={!!errors.customerRequest}
              {...register("customerRequest")}
            />
            <FieldError errors={[errors.customerRequest]} />
          </Field>
          <Field data-invalid={!!errors.hasContacted}>
            <FieldLabel htmlFor="hasContacted">
              {TICKET_FIELDS.hasContacted.label}
              {isRequired("hasContacted") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="hasContacted"
              render={({ field }) => (
                <Select
                  value={field.value === true ? "yes" : field.value === false ? "no" : UNSET}
                  onValueChange={(value) =>
                    field.onChange(value === UNSET ? null : value === "yes")
                  }
                >
                  <SelectTrigger
                    id="hasContacted"
                    className="w-full"
                    aria-invalid={!!errors.hasContacted}
                  >
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
            <FieldError errors={[errors.hasContacted]} />
          </Field>
          <Field data-invalid={!!errors.contactTime}>
            <FieldLabel htmlFor="contactTime-date">
              {TICKET_FIELDS.contactTime.label}
              {isRequired("contactTime") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="contactTime"
              render={({ field }) => (
                <DateTimePicker
                  id="contactTime"
                  value={field.value}
                  onChange={field.onChange}
                  datePickerAriaLabel={`${TICKET_FIELDS.contactTime.label}的日期选择器`}
                  timeAriaLabel={`${TICKET_FIELDS.contactTime.label}的时分`}
                  invalid={!!errors.contactTime}
                />
              )}
            />
            <FieldError errors={[errors.contactTime]} />
          </Field>
          <Field data-invalid={!!errors.contactId}>
            <FieldLabel htmlFor="contactId">
              {TICKET_FIELDS.contactId.label}
              {isRequired("contactId") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input id="contactId" aria-invalid={!!errors.contactId} {...register("contactId")} />
            <FieldError errors={[errors.contactId]} />
          </Field>
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">分类与等级</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.categoryId}>
            <FieldLabel htmlFor="categoryId">
              {TICKET_FIELDS.categoryId.label}
              {isRequired("categoryId") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger
                    id="categoryId"
                    className="w-full"
                    aria-invalid={!!errors.categoryId}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {selectableCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.categoryId]} />
          </Field>
          <Field data-invalid={!!errors.slaPolicyId}>
            <FieldLabel htmlFor="slaPolicyId">
              {TICKET_FIELDS.slaPolicyId.label}
              {isRequired("slaPolicyId") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="slaPolicyId"
              render={({ field }) => (
                <SlaPolicySelect
                  id="slaPolicyId"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  invalid={!!errors.slaPolicyId}
                />
              )}
            />
            <FieldError errors={[errors.slaPolicyId]} />
          </Field>
          <Field data-invalid={!!errors.priority}>
            <FieldLabel htmlFor="priority">
              {TICKET_FIELDS.priority.label}
              {isRequired("priority") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger id="priority" className="w-full" aria-invalid={!!errors.priority}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.priority]} />
          </Field>
        </div>
      </FieldSet>
    </>
  );
}
