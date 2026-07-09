import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DISPLAY_TIME_ZONE } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
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
import { format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { zhCN } from "date-fns/locale";
import { AlertCircle, Calendar as CalendarIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

/**
 * Manual ticket creation (issue #22), presented as a modal dialog over 工单管理
 * rather than a separate page. Validation is the shared ticketCreateInputSchema
 * — the same contract the API parses — with form-side deviations: feedbackTime
 * is held as a datetime-local string until submit (converted to an absolute
 * instant on the 东八区 wall clock), and the enum selects get Chinese "please
 * choose" messages.
 */
const formSchema = ticketCreateInputSchema.extend({
  feedbackTime: z.string().min(1, "请填写反馈时间"),
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: "请选择反馈渠道" }) }),
  category: z.enum(TICKET_CATEGORIES, { errorMap: () => ({ message: "请选择客诉类别" }) }),
  complaintLevel: z.enum(COMPLAINT_LEVELS, { errorMap: () => ({ message: "请选择投诉等级" }) }),
  nuclearBodyStatus: z.enum(NUCLEAR_BODY_STATUSES, {
    errorMap: () => ({ message: "请选择是否核身" }),
  }),
});

type FormValues = z.input<typeof formSchema>;

/** Radix Select forbids `value=""` items; stand-in for "未设置" on 优先级. */
const PRIORITY_UNSET = "__unset__";
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
);

function splitFeedbackTime(value?: string) {
  if (!value) return { date: "", time: "" };
  const [date = "", time = ""] = value.split("T");
  return { date, time };
}

export function TicketCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { hasContacted: false, priority: "" },
  });

  const create = trpc.ticket.create.useMutation({
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已创建`);
      navigate(`/tickets/${ticket.id}`);
    },
  });

  const onSubmit = handleSubmit((values) =>
    create.mutate({
      ...values,
      // datetime-local is a wall-clock string; pin it to 东八区 (ADR 0006)
      // rather than the browser's zone before shipping an absolute instant.
      feedbackTime: fromZonedTime(values.feedbackTime, DISPLAY_TIME_ZONE).toISOString(),
    }),
  );

  const busy = isSubmitting || create.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="flex max-h-[min(720px,90svh)] flex-col gap-0 p-0 sm:max-w-3xl"
        // A long form: don't discard a draft on an accidental outside click.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>
            工单号、处理时限与跟进要求由系统按投诉等级自动生成。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            <FieldSet>
              <FieldLegend variant="label">来源与渠道</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.feedbackTime}>
                  <FieldLabel htmlFor="feedbackTime-date">反馈时间</FieldLabel>
                  <Controller
                    control={control}
                    name="feedbackTime"
                    render={({ field }) => {
                      const parts = splitFeedbackTime(field.value);
                      const [selectedHour = "", selectedMinute = ""] = parts.time.split(":");
                      const selectedDate = parts.date ? new Date(`${parts.date}T00:00:00`) : undefined;

                      return (
                        <div className="flex gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                id="feedbackTime-date"
                                type="button"
                                variant="outline"
                                aria-invalid={!!errors.feedbackTime}
                                className={cn(
                                  "flex-1 justify-start text-left font-normal",
                                  !parts.date && "text-muted-foreground",
                                )}
                              >
                                <CalendarIcon data-icon="inline-start" />
                                {parts.date
                                  ? format(selectedDate!, "PPP", { locale: zhCN })
                                  : "请选择日期"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={selectedDate}
                                onSelect={(date) => {
                                  if (!date) return;
                                  const nextDate = format(date, "yyyy-MM-dd");
                                  field.onChange(
                                    `${nextDate}T${selectedHour || "00"}:${selectedMinute || "00"}`,
                                  );
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                          <Select
                            value={selectedHour}
                            onValueChange={(hour) => {
                              if (!parts.date) return;
                              field.onChange(`${parts.date}T${hour}:${selectedMinute || "00"}`);
                            }}
                            disabled={!parts.date}
                          >
                            <SelectTrigger
                              id="feedbackTime-hour"
                              aria-invalid={!!errors.feedbackTime}
                              className="w-20 shrink-0"
                            >
                              <SelectValue placeholder="时" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {HOUR_OPTIONS.map((hour) => (
                                  <SelectItem key={hour} value={hour}>
                                    {hour} 时
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <Select
                            value={selectedMinute}
                            onValueChange={(minute) => {
                              if (!parts.date) return;
                              field.onChange(`${parts.date}T${selectedHour || "00"}:${minute}`);
                            }}
                            disabled={!parts.date}
                          >
                            <SelectTrigger
                              id="feedbackTime-time"
                              aria-invalid={!!errors.feedbackTime}
                              className="w-20 shrink-0"
                            >
                              <SelectValue placeholder="分" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {MINUTE_OPTIONS.map((minute) => (
                                  <SelectItem key={minute} value={minute}>
                                    {minute} 分
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }}
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
                        <SelectTrigger
                          id="channel"
                          className="w-full"
                          aria-invalid={!!errors.channel}
                        >
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
                  <Input
                    id="phone"
                    type="tel"
                    aria-invalid={!!errors.phone}
                    {...register("phone")}
                  />
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
                  <Input
                    id="contactId"
                    aria-invalid={!!errors.contactId}
                    {...register("contactId")}
                  />
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
                        <SelectTrigger
                          id="category"
                          className="w-full"
                          aria-invalid={!!errors.category}
                        >
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
                        onValueChange={(value) =>
                          field.onChange(value === PRIORITY_UNSET ? "" : value)
                        }
                      >
                        <SelectTrigger
                          id="priority"
                          className="w-full"
                          aria-invalid={!!errors.priority}
                        >
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
          </div>

          <div className="flex flex-col gap-3 border-t px-6 py-4">
            {create.error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>创建失败</AlertTitle>
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {create.isPending && <Spinner data-icon="inline-start" />}
                {create.isPending ? "创建中…" : "创建工单"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
