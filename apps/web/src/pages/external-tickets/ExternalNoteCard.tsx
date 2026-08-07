import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * 外部留言 composer，钉在分栏详情右栏底部：补充信息或回答内部客服的追问。
 * 落成 external_note 处理记录，不动联系次数/处理结果/首响 —— 外部留言不是
 * 我方的客户联系。调用方按未完结门控渲染；服务端同样拒绝已完结工单的留言。
 *
 * 无 Card 外壳：它是右栏的固定页脚，边框与内边距由容器给，自身保持紧凑，
 * 免得挤掉时间线的可视高度。
 */

const NOTE_LIMIT = 2000;

export function ExternalNoteCard({ ticketId }: { ticketId: string }) {
  const utils = trpc.useUtils();
  const [content, setContent] = useState("");

  const addNote = trpc.externalTicket.addNote.useMutation({
    onSuccess: () => {
      toast.success("留言已提交");
      setContent("");
      // 列表也要作废：最新活动时间和摘要可能随留言变化。
      utils.externalTicket.detail.invalidate();
      utils.externalTicket.list.invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="external-note" className="text-xs text-muted-foreground">
          留言内容
        </FieldLabel>
        <Textarea
          id="external-note"
          placeholder="补充信息，或回复客服的追问"
          rows={3}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={NOTE_LIMIT}
          disabled={addNote.isPending}
        />
        <FieldDescription>责任人会收到通知。</FieldDescription>
      </Field>

      {addNote.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>留言失败</AlertTitle>
          <AlertDescription>{addNote.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={addNote.isPending || !content.trim()}
          onClick={() => addNote.mutate({ ticketId, content })}
        >
          {addNote.isPending && <Spinner data-icon="inline-start" />}
          {addNote.isPending ? "提交中…" : "提交留言"}
        </Button>
      </div>
    </div>
  );
}
