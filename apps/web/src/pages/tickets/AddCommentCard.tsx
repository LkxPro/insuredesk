import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  isCompleteLocalDate,
  isCompleteLocalTime,
  isPartialLocalDateTime,
  localDateTimeToIso,
  splitLocalDateTime,
} from "@/lib/local-date-time";
import { trpc } from "@/lib/trpc";

/**
 * 添加跟进 card on the detail page — one submission = one actual customer
 * contact. The caller gates rendering on ticket.process and an in-flight
 * status (assigned/processing); everything derived — contactCount,
 * processingResult, the assigned → processing transition and its ProcessLog
 * pair — happens server-side in ticket.addComment.
 */
export function AddCommentCard({ ticketId }: { ticketId: string }) {
  const utils = trpc.useUtils();
  const [remark, setRemark] = useState("");
  // Held as a partial LOCAL "YYYY-MM-DDTHH:mm" string until submit, like
  // feedbackTime in the create form; "" = no plan (clears any previous one)
  const [nextContactTime, setNextContactTime] = useState("");
  const [nextContactTimeError, setNextContactTimeError] = useState("");

  const addComment = trpc.ticket.addComment.useMutation({
    onSuccess: (result) => {
      toast.success(
        `工单 ${result.workOrderNumber} 已添加跟进（第 ${result.contactCount} 次联系）`,
      );
      setRemark("");
      setNextContactTime("");
      setNextContactTimeError("");
      // Status, 联系次数, 处理结果 and the timeline all change server-side
      utils.ticket.detail.invalidate();
      utils.ticket.list.invalidate();
    },
  });

  function submit() {
    if (!remark.trim()) {
      return;
    }
    if (isPartialLocalDateTime(nextContactTime)) {
      const { date, time } = splitLocalDateTime(nextContactTime);
      if (date && !isCompleteLocalDate(date)) {
        setNextContactTimeError("下次联系时间日期格式不正确，请按 YY-MM-DD 输入");
      } else if (time && !isCompleteLocalTime(time)) {
        setNextContactTimeError("下次联系时间时间格式不正确");
      } else {
        setNextContactTimeError("下次联系时间需同时选择日期和时间");
      }
      return;
    }
    addComment.mutate({
      ticketId,
      remark,
      nextContactTime: localDateTimeToIso(nextContactTime),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">添加跟进</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="follow-up-remark">跟进备注</FieldLabel>
          <Textarea
            id="follow-up-remark"
            placeholder="记录本次电话联系客户的情况"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={2000}
            disabled={addComment.isPending}
          />
        </Field>

        <Field data-invalid={!!nextContactTimeError}>
          <FieldLabel htmlFor="next-contact-time-date">下次联系时间（可选）</FieldLabel>
          <DateTimePicker
            id="next-contact-time"
            value={nextContactTime}
            onChange={(value) => {
              setNextContactTime(value);
              if (!isPartialLocalDateTime(value)) {
                setNextContactTimeError("");
              }
            }}
            datePickerAriaLabel="下次联系时间的日期选择器"
            timeAriaLabel="下次联系时间的时分"
            invalid={!!nextContactTimeError}
          />
          <FieldDescription>每次跟进重新设置；留空则清除已有的下次联系时间。</FieldDescription>
          <FieldError>{nextContactTimeError}</FieldError>
        </Field>

        {addComment.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>添加跟进失败</AlertTitle>
            <AlertDescription>{addComment.error.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={submit} disabled={addComment.isPending || !remark.trim()}>
            {addComment.isPending && <Spinner data-icon="inline-start" />}
            {addComment.isPending ? "提交中…" : "提交跟进"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
