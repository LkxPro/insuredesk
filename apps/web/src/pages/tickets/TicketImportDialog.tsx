import type { AppRouter } from "@insuredesk/api";
import {
  TICKET_IMPORT_BATCH_STATUS_LABELS,
  TICKET_IMPORT_MAX_FILE_BYTES,
  TICKET_IMPORT_ROW_LIMIT,
  type TicketImportBatchStatus,
  type TicketImportFailure,
  type TicketImportRowError,
} from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/datetime";
import { downloadFile } from "@/lib/download";
import { trpc } from "@/lib/trpc";

/**
 * 批量导入 dialog: download the server-generated template (its 渠道/客诉类别
 * dropdowns snapshot the active catalogs — no static asset), fill it in,
 * upload. The upload is all-or-nothing: success reports the imported count,
 * any error keeps the batch out entirely and lists 行号/列名/原因 so the user
 * fixes the ORIGINAL file and re-uploads.
 *
 * Below the upload area, 导入历史 lists the viewer's batches (every batch
 * with ticket.view_all — the scope is server-side). Holders of ticket.delete
 * see 撤销 on revocable batches: an all-or-nothing soft delete of the whole
 * batch, double-confirmed like single deletes.
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

const BATCH_STATUS_VARIANTS: Record<
  TicketImportBatchStatus,
  "outline" | "secondary" | "destructive"
> = {
  revocable: "outline",
  locked: "secondary",
  revoked: "destructive",
};

type ImportBatchItem = inferRouterOutputs<AppRouter>["ticket"]["importBatches"]["items"][number];

function ImportHistory({ enabled }: { enabled: boolean }) {
  const { hasPermission } = useAuth();
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState<ImportBatchItem | null>(null);

  const history = trpc.ticket.importBatches.useQuery({}, { enabled });

  const revoke = trpc.ticket.revokeImportBatch.useMutation({
    onSuccess: (result) => {
      toast.success(`已撤销导入，${result.revoked} 条工单已删除`);
      setConfirming(null);
      utils.ticket.importBatches.invalidate();
      utils.ticket.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      setConfirming(null);
      // 锁定/已撤销的拒绝意味着列表状态已过时
      utils.ticket.importBatches.invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <Separator />
      <h3 className="text-sm font-medium">导入历史</h3>
      {history.isPending && <Spinner className="mx-auto" />}
      {history.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无导入记录</p>
      )}
      {history.data && history.data.items.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-md border text-sm" aria-label="导入历史">
          {history.data.items.map((batch) => (
            <li
              key={batch.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b p-2 last:border-b-0"
            >
              <span className="text-muted-foreground">{formatDateTime(batch.importedAt)}</span>
              <span>{batch.importerName}</span>
              <span>{batch.rowCount} 条</span>
              <span className="min-w-0 flex-1 truncate" title={batch.filename}>
                {batch.filename}
              </span>
              <Badge variant={BATCH_STATUS_VARIANTS[batch.status]}>
                {TICKET_IMPORT_BATCH_STATUS_LABELS[batch.status]}
              </Badge>
              {batch.status === "revocable" && hasPermission("ticket.delete") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => setConfirming(batch)}
                >
                  撤销
                </Button>
              )}
              {batch.status === "revoked" && (
                <span className="basis-full text-xs text-muted-foreground">
                  由 {batch.revokedByName ?? "—"} 于 {formatDateTime(batch.revokedAt)} 撤销
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {history.data && history.data.total > history.data.items.length && (
        <p className="text-xs text-muted-foreground">
          仅显示最近 {history.data.items.length} 批，共 {history.data.total} 批
        </p>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(next) => !next && !revoke.isPending && setConfirming(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>撤销导入</DialogTitle>
            <DialogDescription>
              确定撤销 {confirming && formatDateTime(confirming.importedAt)} 导入的{" "}
              {confirming?.rowCount} 条工单（{confirming?.filename}
              ）吗？整批工单将从列表与所有统计中删除，且本期不提供恢复；批内任一单已有处理则整批撤销会被拒绝。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => setConfirming(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => confirming && revoke.mutate({ batchId: confirming.id })}
            >
              {revoke.isPending && <Spinner data-icon="inline-start" />}
              {revoke.isPending ? "撤销中…" : "确认撤销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
        await Promise.all([
          utils.ticket.list.invalidate(),
          utils.ticket.importBatches.invalidate(),
        ]);
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
      <DialogContent className="sm:max-w-xl">
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

        <ImportHistory enabled={open} />

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
