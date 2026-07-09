import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DISPLAY_TIME_ZONE } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CHANNELS,
  COMPLAINT_LEVELS,
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_CATEGORIES,
  ticketCreateInputSchema,
} from "@insuredesk/shared";
import { fromZonedTime } from "date-fns-tz";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

/**
 * Manual ticket creation (issue #22). Validation is the shared
 * ticketCreateInputSchema — the same contract the API parses — with two
 * form-side deviations: feedbackTime is held as a datetime-local string until
 * submit (converted to an absolute instant on the 东八区 wall clock), and the
 * enum selects get Chinese "please choose" messages.
 */
const formSchema = ticketCreateInputSchema.extend({
  feedbackTime: z.string().min(1, "请填写反馈时间"),
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: "请选择反馈渠道" }) }),
  category: z.enum(TICKET_CATEGORIES, { errorMap: () => ({ message: "请选择客诉类别" }) }),
  complaintLevel: z.enum(COMPLAINT_LEVELS, { errorMap: () => ({ message: "请选择投诉等级" }) }),
});

type FormValues = z.input<typeof formSchema>;

/** Label + control + field error, the repeating row of every section. */
function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function TicketCreate() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { hasContacted: false, priority: "" },
  });

  const create = trpc.ticket.create.useMutation({
    onSuccess: (ticket) => navigate(`/tickets/${ticket.id}`),
  });

  const onSubmit = handleSubmit((values) =>
    create.mutateAsync({
      ...values,
      // datetime-local is a wall-clock string; pin it to 东八区 (ADR 0006)
      // rather than the browser's zone before shipping an absolute instant.
      feedbackTime: fromZonedTime(values.feedbackTime, DISPLAY_TIME_ZONE).toISOString(),
    }),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">新建工单</h1>
        <p className="text-sm text-muted-foreground">
          工单号、处理时限与跟进要求由系统按投诉等级自动生成。
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>来源与渠道</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="反馈时间（东八区）"
              htmlFor="feedbackTime"
              required
              error={errors.feedbackTime?.message}
            >
              <Input id="feedbackTime" type="datetime-local" {...register("feedbackTime")} />
            </Field>
            <Field label="反馈渠道" htmlFor="channel" required error={errors.channel?.message}>
              <NativeSelect id="channel" defaultValue="" {...register("channel")}>
                <option value="" disabled>
                  请选择
                </option>
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>业务信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="项目（保司）" htmlFor="project" required error={errors.project?.message}>
              <Input id="project" placeholder="如：融盛、泰康" {...register("project")} />
            </Field>
            <Field
              label="经纪主体"
              htmlFor="brokerageEntity"
              required
              error={errors.brokerageEntity?.message}
            >
              <Input
                id="brokerageEntity"
                placeholder="如：东方大地"
                {...register("brokerageEntity")}
              />
            </Field>
            <Field
              label="支付渠道"
              htmlFor="paymentChannel"
              required
              error={errors.paymentChannel?.message}
            >
              <Input
                id="paymentChannel"
                placeholder="如：连连支付"
                {...register("paymentChannel")}
              />
            </Field>
            <Field
              label="内部订单号"
              htmlFor="internalOrderNumber"
              error={errors.internalOrderNumber?.message}
            >
              <Input id="internalOrderNumber" {...register("internalOrderNumber")} />
            </Field>
            <Field
              label="保单号"
              htmlFor="policyNumber"
              required
              error={errors.policyNumber?.message}
            >
              <Input id="policyNumber" {...register("policyNumber")} />
            </Field>
            <Field
              label="用户投诉渠道"
              htmlFor="userComplaintChannel"
              required
              error={errors.userComplaintChannel?.message}
            >
              <Input
                id="userComplaintChannel"
                placeholder="如：飞书投诉、400热线"
                {...register("userComplaintChannel")}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>客户信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="客户姓名"
              htmlFor="customerName"
              required
              error={errors.customerName?.message}
            >
              <Input id="customerName" {...register("customerName")} />
            </Field>
            <Field
              label="客户电话（投保人）"
              htmlFor="phone"
              required
              error={errors.phone?.message}
            >
              <Input id="phone" type="tel" {...register("phone")} />
            </Field>
            <Field
              label="联系人电话（备用）"
              htmlFor="contactPhone"
              error={errors.contactPhone?.message}
            >
              <Input id="contactPhone" type="tel" {...register("contactPhone")} />
            </Field>
            <Field
              label="保司侧是否核身"
              htmlFor="nuclearBodyStatus"
              required
              error={errors.nuclearBodyStatus?.message}
            >
              <NativeSelect id="nuclearBodyStatus" {...register("nuclearBodyStatus")}>
                {NUCLEAR_BODY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="客户诉求"
                htmlFor="customerRequest"
                required
                error={errors.customerRequest?.message}
              >
                <Textarea id="customerRequest" rows={4} {...register("customerRequest")} />
              </Field>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                id="hasContacted"
                type="checkbox"
                className="size-4 accent-primary"
                {...register("hasContacted")}
              />
              <Label htmlFor="hasContacted">客户曾进线</Label>
            </div>
            <Field label="进线ID" htmlFor="contactId" error={errors.contactId?.message}>
              <Input id="contactId" {...register("contactId")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>分类与等级</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="客诉类别" htmlFor="category" required error={errors.category?.message}>
              <NativeSelect id="category" defaultValue="" {...register("category")}>
                <option value="" disabled>
                  请选择
                </option>
                {TICKET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="投诉等级"
              htmlFor="complaintLevel"
              required
              error={errors.complaintLevel?.message}
            >
              <NativeSelect id="complaintLevel" defaultValue="" {...register("complaintLevel")}>
                <option value="" disabled>
                  请选择
                </option>
                {COMPLAINT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="优先级（可选）" htmlFor="priority" error={errors.priority?.message}>
              <NativeSelect id="priority" {...register("priority")}>
                <option value="">未设置</option>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>

        {create.error && (
          <p className="text-sm text-destructive" role="alert">
            创建失败：{create.error.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/tickets")}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting || create.isPending}>
            {create.isPending ? "创建中…" : "创建工单"}
          </Button>
        </div>
      </form>
    </div>
  );
}
