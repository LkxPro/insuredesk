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
