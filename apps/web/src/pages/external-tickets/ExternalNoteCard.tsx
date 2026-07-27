import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/**
 * 外部留言：补充信息或回答内部客服的追问。落成 external_note 处理记录，不动
 * 联系次数/处理结果/首响 —— 外部留言不是我方的客户联系。调用方按未完结门控
 * 渲染；服务端同样拒绝已完结工单的留言。
 */

const NOTE_LIMIT = 2000;

export function ExternalNoteCard({ ticketId }: { ticketId: string }) {
  const utils = trpc.useUtils();
  const [content, setContent] = useState("");

  const addNote = trpc.externalTicket.addNote.useMutation({
    onSuccess: () => {
      toast.success("留言已提交");
      setContent("");
      utils.externalTicket.detail.invalidate();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">添加留言</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="external-note">留言内容</FieldLabel>
          <Textarea
            id="external-note"
            placeholder="补充信息，或回复客服的追问"
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
            disabled={addNote.isPending || !content.trim()}
            onClick={() => addNote.mutate({ ticketId, content })}
          >
            {addNote.isPending && <Spinner data-icon="inline-start" />}
            {addNote.isPending ? "提交中…" : "提交留言"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
