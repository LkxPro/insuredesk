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
import {
  CHANNELS,
  COMPLAINT_LEVELS,
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_CATEGORIES,
  ticketCreateInputSchema,
} from "@insuredesk/shared";
import { Controller, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

/**
 * The shared basic-info form body: one field set serving both 新建工单
 * (issue #22) and 编辑工单 (issue #28) — the PRD makes them the same field
 * list by design (§4.5 所有基本信息字段均可编辑), so the dialogs share this
 * component instead of two drifting copies.
 *
 * Validation is the shared ticketCreateInputSchema — the contract the API
 * parses — with form-side deviations: feedbackTime is held as a local
 * datetime string until submit (converted to an absolute instant by the
 * caller), and the enum selects get Chinese "please choose" messages.
 */
export const ticketFormSchema = ticketCreateInputSchema.extend({
  feedbackTime: z.string().min(1, "请填写反馈时间"),
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: "请选择反馈渠道" }) }),
  category: z.enum(TICKET_CATEGORIES, { errorMap: () => ({ message: "请选择客诉类别" }) }),
  complaintLevel: z.enum(COMPLAINT_LEVELS, { errorMap: () => ({ message: "请选择投诉等级" }) }),
  nuclearBodyStatus: z.enum(NUCLEAR_BODY_STATUSES, {
    errorMap: () => ({ message: "请选择是否核身" }),
  }),
});

export type TicketFormValues = z.input<typeof ticketFormSchema>;

/** Radix Select forbids `value=""` items; stand-in for "未设置" on 优先级. */
const PRIORITY_UNSET = "__unset__";

export function TicketFormFields({ form }: { form: UseFormReturn<TicketFormValues> }) {
  const {
    register,
    control,
    formState: { errors },
  } = form;

  return (
    <>
      <FieldSet>
        <FieldLegend variant="label">来源与渠道</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.feedbackTime}>
            <FieldLabel htmlFor="feedbackTime-date">反馈时间</FieldLabel>
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
          <Field data-invalid={!!errors.channel}>
            <FieldLabel htmlFor="channel">反馈渠道</FieldLabel>
            <Controller
              control={control}
              name="channel"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="channel" className="w-full" aria-invalid={!!errors.channel}>
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {CHANNELS.map((channel) => (
                        <SelectItem key={channel} value={channel}>
                          {channel}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.channel]} />
          </Field>
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">业务信息</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.project}>
            <FieldLabel htmlFor="project">项目（保司）</FieldLabel>
            <Input
              id="project"
              placeholder="如：融盛、泰康"
              aria-invalid={!!errors.project}
              {...register("project")}
            />
            <FieldError errors={[errors.project]} />
          </Field>
          <Field data-invalid={!!errors.brokerageEntity}>
            <FieldLabel htmlFor="brokerageEntity">经纪主体</FieldLabel>
            <Input
              id="brokerageEntity"
              placeholder="如：东方大地"
              aria-invalid={!!errors.brokerageEntity}
              {...register("brokerageEntity")}
            />
            <FieldError errors={[errors.brokerageEntity]} />
          </Field>
          <Field data-invalid={!!errors.paymentChannel}>
            <FieldLabel htmlFor="paymentChannel">支付渠道</FieldLabel>
            <Input
              id="paymentChannel"
              placeholder="如：连连支付"
              aria-invalid={!!errors.paymentChannel}
              {...register("paymentChannel")}
            />
            <FieldError errors={[errors.paymentChannel]} />
          </Field>
          <Field data-invalid={!!errors.internalOrderNumber}>
            <FieldLabel htmlFor="internalOrderNumber">内部订单号（选填）</FieldLabel>
            <Input
              id="internalOrderNumber"
              aria-invalid={!!errors.internalOrderNumber}
              {...register("internalOrderNumber")}
            />
            <FieldError errors={[errors.internalOrderNumber]} />
          </Field>
          <Field data-invalid={!!errors.policyNumber}>
            <FieldLabel htmlFor="policyNumber">保单号</FieldLabel>
            <Input
              id="policyNumber"
              aria-invalid={!!errors.policyNumber}
              {...register("policyNumber")}
            />
            <FieldError errors={[errors.policyNumber]} />
          </Field>
          <Field data-invalid={!!errors.userComplaintChannel}>
            <FieldLabel htmlFor="userComplaintChannel">用户投诉渠道</FieldLabel>
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
            <FieldLabel htmlFor="customerName">客户姓名</FieldLabel>
            <Input
              id="customerName"
              aria-invalid={!!errors.customerName}
              {...register("customerName")}
            />
            <FieldError errors={[errors.customerName]} />
          </Field>
          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">客户电话（投保人）</FieldLabel>
            <Input id="phone" type="tel" aria-invalid={!!errors.phone} {...register("phone")} />
            <FieldError errors={[errors.phone]} />
          </Field>
          <Field data-invalid={!!errors.contactPhone}>
            <FieldLabel htmlFor="contactPhone">联系人电话（选填）</FieldLabel>
            <Input
              id="contactPhone"
              type="tel"
              aria-invalid={!!errors.contactPhone}
              {...register("contactPhone")}
            />
            <FieldError errors={[errors.contactPhone]} />
          </Field>
          <Field data-invalid={!!errors.nuclearBodyStatus}>
            <FieldLabel htmlFor="nuclearBodyStatus">保司侧是否核身</FieldLabel>
            <Controller
              control={control}
              name="nuclearBodyStatus"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="nuclearBodyStatus"
                    className="w-full"
                    aria-invalid={!!errors.nuclearBodyStatus}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
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
            <FieldLabel htmlFor="customerRequest">客户诉求</FieldLabel>
            <Textarea
              id="customerRequest"
              rows={4}
              aria-invalid={!!errors.customerRequest}
              {...register("customerRequest")}
            />
            <FieldError errors={[errors.customerRequest]} />
          </Field>
          <Field orientation="horizontal">
            <Controller
              control={control}
              name="hasContacted"
              render={({ field }) => (
                <Checkbox
                  id="hasContacted"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <FieldLabel htmlFor="hasContacted" className="font-normal">
              客户曾进线
            </FieldLabel>
          </Field>
          <Field data-invalid={!!errors.contactId}>
            <FieldLabel htmlFor="contactId">进线ID（选填）</FieldLabel>
            <Input id="contactId" aria-invalid={!!errors.contactId} {...register("contactId")} />
            <FieldError errors={[errors.contactId]} />
          </Field>
        </div>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">分类与等级</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.category}>
            <FieldLabel htmlFor="category">客诉类别</FieldLabel>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="category" className="w-full" aria-invalid={!!errors.category}>
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {TICKET_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.category]} />
          </Field>
          <Field data-invalid={!!errors.complaintLevel}>
            <FieldLabel htmlFor="complaintLevel">投诉等级</FieldLabel>
            <Controller
              control={control}
              name="complaintLevel"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="complaintLevel"
                    className="w-full"
                    aria-invalid={!!errors.complaintLevel}
                  >
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
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
            <FieldLabel htmlFor="priority">优先级（选填）</FieldLabel>
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <Select
                  value={field.value ? field.value : PRIORITY_UNSET}
                  onValueChange={(value) => field.onChange(value === PRIORITY_UNSET ? "" : value)}
                >
                  <SelectTrigger id="priority" className="w-full" aria-invalid={!!errors.priority}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={PRIORITY_UNSET}>未设置</SelectItem>
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
