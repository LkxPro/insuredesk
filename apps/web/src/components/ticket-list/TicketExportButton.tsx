import type { TicketExportFormat, TicketListQuery } from "@insuredesk/shared";
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
import { downloadTicketExport } from "./ticket-export";

/** 导出当前筛选结果 — the server re-applies scope and filters. */
export function TicketExportButton({ query }: { query: TicketListQuery }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: TicketExportFormat) {
    setExporting(true);
    try {
      await downloadTicketExport(query, format);
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
