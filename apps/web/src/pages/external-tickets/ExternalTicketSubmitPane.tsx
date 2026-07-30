import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * 提交工单：外部端的首屏与主操作，大文本框是唯一输入。业务字段（渠道/类别/
 * 客户信息）由客服后补，6 个身份类字段由服务端按当前账号的预填静默盖章，
 * 所以这里不给外部方任何别的字段。原文创建后不可编辑，提交前的本地校验
 * 因此对齐服务端。
 */

const SUBMISSION_TEXT_LIMIT = 2000;

export function ExternalTicketSubmitPane() {
  const utils = trpc.useUtils();
  const [submissionText, setSubmissionText] = useState("");
  const [error, setError] = useState("");

  const submit = trpc.externalTicket.submit.useMutation({
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已提交`);
      utils.externalTicket.list.invalidate();
      setSubmissionText("");
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = submissionText.trim();
    if (!text) {
      setError("请填写工单原文");
      return;
    }
    if (text.length > SUBMISSION_TEXT_LIMIT) {
      setError(`工单原文不能超过 ${SUBMISSION_TEXT_LIMIT} 字（当前 ${text.length} 字）`);
      return;
    }
    setError("");
    submit.mutate({ submissionText: text });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">提交工单</h1>
        <p className="text-sm text-muted-foreground">
          粘贴客户反馈原文即可，工单号与后续业务字段由客服团队补全。
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4" noValidate>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="submission-text">工单原文</FieldLabel>
          <Textarea
            id="submission-text"
            className="min-h-64"
            placeholder="粘贴客户反馈原文，如微信群里客户的原始描述"
            value={submissionText}
            onChange={(event) => {
              setSubmissionText(event.target.value);
              if (error) setError("");
            }}
            maxLength={SUBMISSION_TEXT_LIMIT}
            disabled={submit.isPending}
            aria-invalid={!!error}
            autoFocus
          />
          <FieldDescription>
            {submissionText.length} / {SUBMISSION_TEXT_LIMIT} 字，提交后不可修改。
          </FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>

        {submit.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>提交失败</AlertTitle>
            <AlertDescription>{submit.error.message}</AlertDescription>
          </Alert>
        )}

        <div>
          <Button type="submit" disabled={submit.isPending}>
            {submit.isPending && <Spinner data-icon="inline-start" />}
            {submit.isPending ? "提交中…" : "提交工单"}
          </Button>
        </div>
      </form>
    </div>
  );
}
