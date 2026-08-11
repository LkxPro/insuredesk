import type { TicketExportFormat } from "@insuredesk/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 导出当前筛选结果 — the server re-applies scope and filters. 按钮只管交互
 * 与导出中状态；URL 构造与下载由 onExport 决定（内外列表各有一份 builder）。
 */
export function TicketExportButton({
  onExport,
}: {
  onExport: (format: TicketExportFormat) => Promise<void>;
}) {
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: TicketExportFormat) {
    setExporting(true);
    try {
      await onExport(format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={exporting}>
          <Download data-icon="inline-start" />
          {exporting ? "导出中…" : "导出"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handleExport("xlsx")}>
          导出 Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleExport("csv")}>导出 CSV (.csv)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
