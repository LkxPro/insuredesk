import {
  TICKET_IMPORT_MAX_FILE_BYTES,
  TICKET_IMPORT_ROW_LIMIT,
  type TicketImportFailure,
  type TicketImportRowError,
} from "@insuredesk/shared";
import { Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
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
import { trpc } from "@/lib/trpc";

/**
 * 批量导入 dialog: download the server-generated template (its 渠道/客诉类别
 * dropdowns snapshot the active catalogs — no static asset), fill it in,
 * upload. The upload is all-or-nothing: success reports the imported count,
 * any error keeps the batch out entirely and lists 行号/列名/原因 so the user
 * fixes the ORIGINAL file and re-uploads.
 */

type ImportOutcome =
  | { kind: "success"; imported: number }
  | { kind: "failure"; error: string; rowErrors: TicketImportRowError[] };

/** Server rejections carry TicketImportFailure JSON; anything else gets a generic line. */
async function extractFailure(response: Response): Promise<ImportOutcome> {
  try {
    const body = (await response.json()) as Partial<TicketImportFailure>;
    if (body.error) {
      return { kind: "failure", error: body.error, rowErrors: body.rowErrors ?? [] };
    }
  } catch {
    // non-JSON body (proxy error page, say) — fall through
  }
  return { kind: "failure", error: `导入失败（${response.status}）`, rowErrors: [] };
}

export function TicketImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

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

  function handleFileChange(selected: File | null) {
    setFile(selected);
    setOutcome(null);
  }

  async function handleUpload() {
    if (!file) {
      return;
    }
    if (file.size > TICKET_IMPORT_MAX_FILE_BYTES) {
      setOutcome({
        kind: "failure",
        error: `文件大小超过 ${TICKET_IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB 上限`,
        rowErrors: [],
      });
      return;
    }

    setUploading(true);
    setOutcome(null);
    try {
      const formData = new FormData();
      // Fields must precede the file part — the server reads them alongside it
      formData.append("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone);
      formData.append("file", file, file.name);
      const response = await fetch("/api/tickets/import", { method: "POST", body: formData });
      if (response.ok) {
        const { imported } = (await response.json()) as { imported: number };
        setOutcome({ kind: "success", imported });
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        // The new tickets are already in the viewer's list scope
        await utils.ticket.list.invalidate();
      } else {
        setOutcome(await extractFailure(response));
      }
    } catch {
      setOutcome({ kind: "failure", error: "网络错误，请稍后重试", rowErrors: [] });
    } finally {
      setUploading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFile(null);
      setOutcome(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入工单</DialogTitle>
          <DialogDescription>
            下载模板，按其「填写说明」填写后上传；一次最多 {TICKET_IMPORT_ROW_LIMIT} 行。
            任一行有误则整批不导入，请修正原文件后重新上传。
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

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
          <FileUp className="size-6" />
          <span>{file ? file.name : "点击选择填写好的模板文件（.xlsx，≤2MB）"}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="sr-only"
            aria-label="选择导入文件"
            onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
          />
        </label>

        {outcome?.kind === "success" && (
          <p className="text-sm text-emerald-600" role="status">
            成功导入 {outcome.imported} 条
          </p>
        )}

        {outcome?.kind === "failure" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive" role="alert">
              {outcome.error}
            </p>
            {outcome.rowErrors.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm">
                {outcome.rowErrors.map((rowError) => (
                  <li
                    // 服务端保证 (行, 列) 每对至多一个错误
                    key={`${rowError.row}-${rowError.column}`}
                    className="border-b py-1 last:border-b-0"
                  >
                    {rowError.row !== null && (
                      <span className="font-medium">第 {rowError.row} 行</span>
                    )}
                    {rowError.column !== null && (
                      <span className="text-muted-foreground">「{rowError.column}」</span>
                    )}
                    <span> {rowError.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              关闭
            </Button>
          </DialogClose>
          <Button type="button" disabled={!file || uploading} onClick={handleUpload}>
            {uploading ? "导入中…" : "上传并导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
