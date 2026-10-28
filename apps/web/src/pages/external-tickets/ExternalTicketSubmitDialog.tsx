import { externalTicketSubmitInputSchema } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { DuplicateTicketList } from "@/pages/tickets/TicketDuplicates";

/**
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
  onSubmitted: (ticket: { id: string; workOrderNumber: string }) => void;
}) {
  const utils = trpc.useUtils();
  const [submissionText, setSubmissionText] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [debouncedPhone, setDebouncedPhone] = useState("");
  const [error, setError] = useState("");
  const normalizedPhone = phone.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPhone(normalizedPhone), 400);
    return () => clearTimeout(timer);
  }, [normalizedPhone]);
  const canQuery =
    open &&
    normalizedPhone === debouncedPhone &&
    externalTicketSubmitInputSchema.shape.phone.safeParse(normalizedPhone).success;
  const related = trpc.externalTicket.findRelated.useQuery(
    { phone: debouncedPhone },
    { enabled: canQuery, retry: false },
  );
  const hasRelated = canQuery && (related.data?.length ?? 0) > 0;
  const canCreate = canQuery && related.isSuccess && !related.isFetching && !hasRelated;

  const submit = trpc.externalTicket.submit.useMutation({
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        utils.externalTicket.findRelated.invalidate();
      }
    },
    onSuccess: (ticket) => {
      toast.success(`工单 ${ticket.workOrderNumber} 已提交`);
      utils.externalTicket.list.invalidate();
      utils.externalTicket.findRelated.invalidate();
      utils.externalTicket.detail.invalidate();
      onSubmitted(ticket);
    },
  });

  // 重置放在打开时：成功路径由父组件直接关窗（不经 onOpenChange），且 mutation
  // 的 error 状态跨关闭存活——关闭时清空这两条都兜不住。
  useEffect(() => {
    if (open) {
      setSubmissionText("");
      setPhone("");
      setPhoneError("");
      setDebouncedPhone("");
      setError("");
      submit.reset();
    }
  }, [open, submit.reset]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsedPhone = externalTicketSubmitInputSchema.shape.phone.safeParse(phone);
    if (!parsedPhone.success) {
      setPhoneError(parsedPhone.error.issues[0]?.message ?? "请填写投保人手机号");
      return;
    }
    if (!canCreate) return;
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
    submit.mutate({ submissionText: text, phone: parsedPhone.data });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>
            先查询自己未完结的工单；有匹配时直接进入已有工单，无匹配时填写原文新建。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FieldGroup>
            <Field data-invalid={!!phoneError}>
              <FieldLabel htmlFor="holder-phone">投保人手机号（必填）</FieldLabel>
              <Input
                id="holder-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setPhoneError("");
                }}
                disabled={submit.isPending}
                aria-invalid={!!phoneError}
                aria-describedby="holder-phone-help holder-phone-error"
                autoFocus
              />
              <FieldDescription id="holder-phone-help">
                输入 11 位手机号，查询自己未完结工单中的相同投保人电话或联系人电话。
              </FieldDescription>
              <FieldError id="holder-phone-error">{phoneError}</FieldError>
              {canQuery && (
                <div aria-live="polite">
                  {related.isFetching ? (
                    <p className="text-sm text-muted-foreground">正在查询关联工单…</p>
                  ) : related.error ? (
                    <Alert variant="destructive">
                      <AlertTitle>关联工单查询失败</AlertTitle>
                      <AlertDescription>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => related.refetch()}
                        >
                          重试
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : related.data && related.data.length > 0 ? (
                    <Alert>
                      <AlertTitle>发现 {related.data.length} 个关联工单</AlertTitle>
                      <AlertDescription>
                        <div className="max-h-48 overflow-y-auto">
                          <DuplicateTicketList
                            duplicates={related.data}
                            basePath="/external-tickets"
                          />
                        </div>
                        <p>已有未完结工单，请点击工单号进入处理，无需新建。</p>
                      </AlertDescription>
                    </Alert>
                  ) : related.data ? (
                    <p className="text-sm text-muted-foreground">暂无关联工单</p>
                  ) : null}
                </div>
              )}
            </Field>
            {!hasRelated && (
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
                />
                <FieldDescription>
                  {submissionText.length} / {SUBMISSION_TEXT_LIMIT} 字，提交后不可修改。
                </FieldDescription>
                <FieldError>{error}</FieldError>
              </Field>
            )}
          </FieldGroup>

          {submit.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>提交失败</AlertTitle>
              <AlertDescription>{submit.error.message}</AlertDescription>
            </Alert>
          )}

          {!hasRelated && (
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  submit.isPending ||
                  (externalTicketSubmitInputSchema.shape.phone.safeParse(normalizedPhone).success &&
                    !canCreate)
                }
              >
                {submit.isPending && <Spinner data-icon="inline-start" />}
                {submit.isPending ? "提交中…" : "提交工单"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
