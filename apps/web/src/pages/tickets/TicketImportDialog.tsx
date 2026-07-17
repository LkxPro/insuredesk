import { TICKET_IMPORT_ROW_LIMIT } from "@insuredesk/shared";
import { Download, FileUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { downloadFile } from "@/lib/download";

/**
 * 批量导入 dialog: template download only for now — the upload area is a
 * deliberate placeholder, not an omission. The template is generated
 * server-side per download (its 渠道/客诉类别 dropdowns snapshot the active
 * catalogs), so there is no static asset to link.
 */
export function TicketImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await downloadFile("/api/tickets/import-template", "工单导入模板.xlsx");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入工单</DialogTitle>
          <DialogDescription>
            下载模板，按其「填写说明」填写后上传；一次最多 {TICKET_IMPORT_ROW_LIMIT} 行。
          </DialogDescription>
        </DialogHeader>

        <Button
          variant="outline"
          className="justify-self-start"
          disabled={downloading}
          onClick={handleDownloadTemplate}
        >
          <Download data-icon="inline-start" />
          {downloading ? "下载中…" : "下载模板"}
        </Button>

        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          <FileUp className="size-6" />
          <p>上传功能即将上线</p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              关闭
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
