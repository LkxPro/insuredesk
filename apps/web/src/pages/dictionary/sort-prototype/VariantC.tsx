// 原型（可丢弃）变体 C：排序模式下拉——名称序只是预览，拖拽锁定，点「保存此顺序」才覆盖真实顺序。
import { ArrowDownAZ } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { type NameSortDir, sortByName } from "./name-sort";
import { PanelShell, usePanel } from "./panel-shared";

export const variantCName = "模式预览+显式保存";

type Mode = "manual" | NameSortDir;

export function VariantC({ config }: { config: CatalogAdminConfig }) {
  const panel = usePanel(config);
  const [mode, setMode] = useState<Mode>("manual");

  const preview = mode === "manual" ? null : sortByName(panel.rows, mode);

  function savePreview() {
    if (!preview) return;
    panel.moveRows(preview);
    setMode("manual");
    toast.success("已保存为手动顺序，表单下拉同步生效");
  }

  return (
    <PanelShell
      config={config}
      panel={panel}
      rows={preview ?? panel.rows}
      dragEnabled={mode === "manual"}
      tag={`C · ${variantCName}`}
      hint="切换排序方式预览效果；名称序保存后才影响表单下拉。"
      toolbarExtra={
        <Select value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <SelectTrigger size="sm" className="w-44" aria-label="排序方式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">手动排序</SelectItem>
            <SelectItem value="asc">名称 A→Z（拼音）</SelectItem>
            <SelectItem value="desc">名称 Z→A（拼音）</SelectItem>
          </SelectContent>
        </Select>
      }
      banner={
        preview && (
          <Alert>
            <ArrowDownAZ />
            <AlertTitle>按名称{mode === "asc" ? "升序" : "降序"}预览中</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>拖拽已锁定；保存后才会替换手动顺序。</span>
              <span className="flex items-center gap-2">
                <Button size="sm" onClick={savePreview} disabled={panel.reorderPending}>
                  保存此顺序
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("manual")}>
                  取消
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )
      }
    />
  );
}
