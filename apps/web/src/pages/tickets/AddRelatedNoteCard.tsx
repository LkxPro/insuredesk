import type { TicketRelatedMatch } from "@insuredesk/shared";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

export function AddRelatedNoteCard({
  ticketId,
  match,
}: {
  ticketId: string;
  match: TicketRelatedMatch;
}) {
  const [remark, setRemark] = useState("");
  const utils = trpc.useUtils();
  const refresh = () => {
    utils.ticket.findRelated.invalidate();
    utils.ticket.relatedDetail.invalidate();
    utils.ticket.detail.invalidate();
  };
  const addNote = trpc.ticket.addRelatedNote.useMutation({
    onSuccess: () => {
      setRemark("");
      toast.success("已追加内部备注");
      refresh();
    },
    onError: refresh,
  });
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="related-note">补充备注（仅内部可见）</FieldLabel>
        <Textarea
          id="related-note"
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          rows={3}
          maxLength={2000}
          disabled={addNote.isPending}
        />
      </Field>
      {addNote.error && (
        <Alert variant="destructive">
          <AlertTitle>追加失败</AlertTitle>
          <AlertDescription>{addNote.error.message}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        disabled={addNote.isPending || !remark.trim()}
        onClick={() => addNote.mutate({ ticketId, match, remark })}
      >
        {addNote.isPending && <Spinner data-icon="inline-start" />}
        追加备注
      </Button>
    </FieldGroup>
  );
}
