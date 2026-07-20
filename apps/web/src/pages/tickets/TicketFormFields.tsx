import {
  COMPLAINT_LEVELS,
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_CREATE_FIELD_KEYS,
  TICKET_FIELDS,
  type TicketCreateFieldKey,
  ticketCreateInputSchema,
} from "@insuredesk/shared";
import { Controller, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateTimePicker } from "@/components/DateTimePicker";
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
import { trpc } from "@/lib/trpc";

/**
 * The shared basic-info form body: one field set serving both 新建工单 and
 * 编辑工单 — they are the same field list by design (所有基本信息字段均可编辑),
 * so the dialogs share this component instead of two drifting copies.
 *
 * Every field is optional: a fully blank form submits cleanly and unfilled
 * fields reach the server as null. No label says 选填 — optional is the rule,
 * not the exception. Validation is the shared ticketCreateInputSchema — the
 * contract the API parses — with one form-side deviation: datetime fields are
 * held as local datetime strings ("" = unfilled) until submit, when the
 * caller converts them to absolute instants or null.
 *
 * 动态必填：建单表单据用户角色的必填集生成校验，编辑表单不受约束。必填字段标签后显示星号。
 */
export function buildTicketFormSchema(requiredFields: readonly string[]) {
  let schema = ticketCreateInputSchema.extend({
    feedbackTime: z.string(),
    contactTime: z.string(),
  });

  const requiredExtension: Record<string, z.ZodTypeAny> = {};
  for (const key of TICKET_CREATE_FIELD_KEYS) {
    if (requiredFields.includes(key)) {
      requiredExtension[key] = requiredFieldSchema(TICKET_FIELDS[key]);
    }
  }

  if (Object.keys(requiredExtension).length > 0) {
    schema = schema.extend(requiredExtension) as typeof schema;
  }

  return schema;
}

/** 类型错误也用必填句——未触碰的下拉提交时是 undefined，不能落到 zod 默认英文文案。 */
function requiredFieldSchema(descriptor: (typeof TICKET_FIELDS)[TicketCreateFieldKey]) {
  const message = `${descriptor.label}为必填项`;
  switch (descriptor.type) {
    case "text":
      return z.string(message).trim().min(1, message).max(descriptor.maxLength);
    case "enum":
      // 布尔取值的三态字段（客户曾进线）在表单里就是 boolean|null
      return typeof descriptor.options[0]?.value === "boolean"
        ? z.boolean({ error: message })
        : z.string(message).min(1, message);
    case "date":
    case "catalog":
      // date 在表单里是本地时间字符串（"" = 未填），catalog 是目录 id
      return z.string(message).min(1, message);
  }
}

export const ticketFormSchema = ticketCreateInputSchema.extend({
  feedbackTime: z.string(),
  contactTime: z.string(),
});

export type TicketFormValues = z.input<typeof ticketFormSchema>;

/** Local datetime string ("YYYY-MM-DDTHH:mm") → absolute instant; "" stays null (未填写). */
export function localDateTimeToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Radix Select forbids `value=""` items; stand-in for the "未设置" choice. */
const UNSET = "__unset__";

/** hasContacted is tri-state (是/否/未知) — a checkbox can't say "unknown". Radix 不收布尔 value，转码为哨兵串。 */
const HAS_CONTACTED_OPTIONS = TICKET_FIELDS.hasContacted.options.map((option) => ({
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
function withCurrentOption(
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
              placeholder="如：融盛、泰康"
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
              placeholder="如：东方大地"
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
              placeholder="如：连连支付"
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
          <Field data-invalid={!!errors.policyNumber}>
            <FieldLabel htmlFor="policyNumber">
              {TICKET_FIELDS.policyNumber.label}
              {isRequired("policyNumber") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="policyNumber"
              aria-invalid={!!errors.policyNumber}
              {...register("policyNumber")}
            />
            <FieldError errors={[errors.policyNumber]} />
          </Field>
          <Field data-invalid={!!errors.userComplaintChannel}>
            <FieldLabel htmlFor="userComplaintChannel">
              {TICKET_FIELDS.userComplaintChannel.label}
              {isRequired("userComplaintChannel") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="userComplaintChannel"
              placeholder="如：飞书投诉、400热线"
              aria-invalid={!!errors.userComplaintChannel}
              {...register("userComplaintChannel")}
            />
            <FieldError errors={[errors.userComplaintChannel]} />
          </Field>
          <Field data-invalid={!!errors.complaintReceiveChannel}>
            <FieldLabel htmlFor="complaintReceiveChannel">
              {TICKET_FIELDS.complaintReceiveChannel.label}
              {isRequired("complaintReceiveChannel") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input
              id="complaintReceiveChannel"
              placeholder="如：监管转办、邮箱接收"
              aria-invalid={!!errors.complaintReceiveChannel}
              {...register("complaintReceiveChannel")}
            />
            <FieldError errors={[errors.complaintReceiveChannel]} />
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
          <Field data-invalid={!!errors.complaintLevel}>
            <FieldLabel htmlFor="complaintLevel">
              {TICKET_FIELDS.complaintLevel.label}
              {isRequired("complaintLevel") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Controller
              control={control}
              name="complaintLevel"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : UNSET}
                  onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                >
                  <SelectTrigger
                    id="complaintLevel"
                    className="w-full"
                    aria-invalid={!!errors.complaintLevel}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNSET}>未设置</SelectItem>
                      {COMPLAINT_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.complaintLevel]} />
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
