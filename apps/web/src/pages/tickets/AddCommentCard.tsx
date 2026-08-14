import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  isCompleteLocalDate,
  isCompleteLocalTime,
  isPartialLocalDateTime,
  localDateTimeToIso,
  splitLocalDateTime,
} from "@/lib/local-date-time";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

/**
 * 添加跟进 composer，钉在分栏详情右栏底部 —— one submission = one actual
 * customer contact. 调用方按 ticket.process 与在途状态门控渲染；一切派生
 * （contactCount、processingResult、assigned → processing 及其 ProcessLog 对）
 * 都在服务端的 ticket.addComment 里发生。
 *
 * 无 Card 外壳：它是右栏的固定页脚，边框与内边距由容器给，自身保持紧凑，
 * 免得挤掉时间线的可视高度。
 */
export function AddCommentCard({ ticketId }: { ticketId: string }) {
  const utils = trpc.useUtils();
  const [remark, setRemark] = useState("");
  // Held as a partial LOCAL "YYYY-MM-DDTHH:mm" string until submit, like
  // feedbackTime in the create form; "" = no plan (clears any previous one)
  const [nextContactTime, setNextContactTime] = useState("");
  const [nextContactTimeError, setNextContactTimeError] = useState("");
  // 默认不勾：跟进对外可见是常态，仅内部可见是坐席的显式决定
  const [internalOnly, setInternalOnly] = useState(false);

  const addComment = trpc.ticket.addComment.useMutation({
    onSuccess: (result) => {
      toast.success(
        `工单 ${result.workOrderNumber} 已添加跟进（第 ${result.contactCount} 次联系）`,
      );
      setRemark("");
      setNextContactTime("");
      setNextContactTimeError("");
      setInternalOnly(false);
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
      internalOnly,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="follow-up-remark" className="text-xs text-muted-foreground">
          跟进备注
        </FieldLabel>
        <Textarea
          id="follow-up-remark"
          placeholder="记录本次电话联系客户的情况"
          rows={3}
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          maxLength={2000}
          disabled={addComment.isPending}
        />
      </Field>

      <Field data-invalid={!!nextContactTimeError}>
        <FieldLabel
          htmlFor="next-contact-time-date"
          className="text-xs font-normal text-muted-foreground"
        >
          下次联系时间（可选，留空则清除已有计划）
        </FieldLabel>
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
        <FieldError>{nextContactTimeError}</FieldError>
      </Field>

      {addComment.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>添加跟进失败</AlertTitle>
          <AlertDescription>{addComment.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="internal-only"
            checked={internalOnly}
            onCheckedChange={(checked) => setInternalOnly(checked === true)}
            disabled={addComment.isPending}
          />
          <FieldLabel htmlFor="internal-only" className="font-normal text-muted-foreground">
            仅内部可见
          </FieldLabel>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={addComment.isPending || !remark.trim()}
        >
          {addComment.isPending && <Spinner data-icon="inline-start" />}
          {addComment.isPending ? "提交中…" : "提交跟进"}
        </Button>
      </div>
    </div>
  );
}
