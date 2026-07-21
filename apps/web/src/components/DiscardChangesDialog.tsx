import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 丢弃修改？ confirmation, stacked over a form dialog whose close was
 * intercepted because the form is dirty. Only the explicit destructive
 * confirm discards; closing this dialog any other way (继续编辑, X, Esc,
 * outside click) returns to the still-open form with the draft intact.
 */
export function DiscardChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>丢弃修改？</DialogTitle>
          <DialogDescription>当前修改尚未提交，丢弃后将无法恢复。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              继续编辑
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            丢弃修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
