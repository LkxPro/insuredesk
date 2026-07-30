import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * 新建工单对话框：大文本框是唯一输入。业务字段（渠道/类别/客户信息）由客服
 * 后补，6 个身份类字段由服务端按当前账号的预填静默盖章，所以这里不给外部方
 * 任何别的字段。原文创建后不可编辑，提交前的本地校验因此对齐服务端。
 * 草稿不跨开关存活——重开就是新的一单。
 */

const SUBMISSION_TEXT_LIMIT = 2000;

export function ExternalTicketSubmitDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 提交成功：调用方负责把新单选进右栏（外部方立刻看到它落地）。 */
  onSubmitted: (ticket: { id: string; workOrderNumber: string }) => void;
}) {
  const utils = trpc.useUtils();
  const [submissionText, setSubmissionText] = useState("");
  const [error, setError] = useState("");

  const submit = trpc.externalTicket.submit.useMutation({
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已提交`);
      utils.externalTicket.list.invalidate();
      onSubmitted(ticket);
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSubmissionText("");
      setError("");
    }
    onOpenChange(next);
  }

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>
            粘贴客户反馈原文即可，工单号与后续业务字段由客服团队补全。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="submission-text">工单原文</FieldLabel>
            <Textarea
              id="submission-text"
              className="min-h-48"
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

          <DialogFooter>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending && <Spinner data-icon="inline-start" />}
              {submit.isPending ? "提交中…" : "提交工单"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
