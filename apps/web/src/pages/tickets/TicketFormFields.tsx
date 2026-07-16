import {
  COMPLAINT_LEVELS,
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
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
 * contract the API parses — with one form-side deviation: feedbackTime is
 * held as a local datetime string ("" = unfilled) until submit, when the
 * caller converts it to an absolute instant or null.
 *
 * 动态必填：建单表单据用户角色的必填集生成校验，编辑表单不受约束。必填字段标签后显示星号。
 */
export function buildTicketFormSchema(requiredFields: readonly string[]) {
  let schema = ticketCreateInputSchema.extend({
    feedbackTime: z.string(),
  });

  const requiredFieldTransforms: Partial<Record<TicketCreateFieldKey, z.ZodTypeAny>> = {
    feedbackTime: z.string().min(1, "反馈时间为必填项"),
    channelId: z.string().min(1, "业务渠道为必填项"),
    project: z.string().trim().min(1, "项目名称为必填项").max(100),
    brokerageEntity: z.string().trim().min(1, "经纪主体为必填项").max(100),
    paymentChannel: z.string().trim().min(1, "支付渠道为必填项").max(100),
    internalOrderNumber: z.string().trim().min(1, "内部工单号为必填项").max(200),
    policyNumber: z.string().trim().min(1, "保单号为必填项").max(100),
    userComplaintChannel: z.string().trim().min(1, "用户投诉渠道为必填项").max(100),
    customerName: z.string().trim().min(1, "客户姓名为必填项").max(100),
    phone: z.string().trim().min(1, "手机号为必填项").max(50),
    contactPhone: z.string().trim().min(1, "联系电话为必填项").max(200),
    customerRequest: z.string().trim().min(1, "客户诉求为必填项").max(2000),
    nuclearBodyStatus: z.string().min(1, "保司侧是否核身为必填项"),
    hasContacted: z.boolean({ error: "是否已联系为必填项" }),
    contactId: z.string().trim().min(1, "联系人ID为必填项").max(200),
    categoryId: z.string().min(1, "分类为必填项"),
    complaintLevel: z.string().min(1, "投诉等级为必填项"),
    priority: z.string().min(1, "优先级为必填项"),
  };

  const requiredExtension: Record<string, z.ZodTypeAny> = {};
  for (const field of requiredFields) {
    const transform = requiredFieldTransforms[field as TicketCreateFieldKey];
    if (transform) {
      requiredExtension[field] = transform;
    }
  }

  if (Object.keys(requiredExtension).length > 0) {
    schema = schema.extend(requiredExtension) as typeof schema;
  }

  return schema;
}

export const ticketFormSchema = ticketCreateInputSchema.extend({
  feedbackTime: z.string(),
});

export type TicketFormValues = z.input<typeof ticketFormSchema>;

/** Radix Select forbids `value=""` items; stand-in for the "未设置" choice. */
const UNSET = "__unset__";

/** hasContacted is tri-state (是/否/未知) — a checkbox can't say "unknown". */
const HAS_CONTACTED_OPTIONS = [
  { value: "yes", label: "是" },
  { value: "no", label: "否" },
] as const;

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
              反馈时间{isRequired("feedbackTime") && <span className="text-destructive">*</span>}
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
              反馈渠道{isRequired("channelId") && <span className="text-destructive">*</span>}
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
              项目（保司）{isRequired("project") && <span className="text-destructive">*</span>}
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
              经纪主体{isRequired("brokerageEntity") && <span className="text-destructive">*</span>}
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
              支付渠道{isRequired("paymentChannel") && <span className="text-destructive">*</span>}
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
              内部订单号
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
              保单号{isRequired("policyNumber") && <span className="text-destructive">*</span>}
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
              用户投诉渠道
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
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">客户信息</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.customerName}>
            <FieldLabel htmlFor="customerName">
              客户姓名{isRequired("customerName") && <span className="text-destructive">*</span>}
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
              客户电话（投保人）{isRequired("phone") && <span className="text-destructive">*</span>}
            </FieldLabel>
            <Input id="phone" type="tel" aria-invalid={!!errors.phone} {...register("phone")} />
            <FieldError errors={[errors.phone]} />
          </Field>
          <Field data-invalid={!!errors.contactPhone}>
            <FieldLabel htmlFor="contactPhone">
              联系人电话{isRequired("contactPhone") && <span className="text-destructive">*</span>}
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
              保司侧是否核身
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
              客户诉求{isRequired("customerRequest") && <span className="text-destructive">*</span>}
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
              客户曾进线{isRequired("hasContacted") && <span className="text-destructive">*</span>}
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
          <Field data-invalid={!!errors.contactId}>
            <FieldLabel htmlFor="contactId">
              进线ID{isRequired("contactId") && <span className="text-destructive">*</span>}
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
              客诉类别{isRequired("categoryId") && <span className="text-destructive">*</span>}
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
              投诉等级{isRequired("complaintLevel") && <span className="text-destructive">*</span>}
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
              优先级{isRequired("priority") && <span className="text-destructive">*</span>}
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
