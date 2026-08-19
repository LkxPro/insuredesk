// 原型（可丢弃）变体 B：工具栏「按名称排序」是一次性动作——直接把真实顺序改成拼音序，toast 可撤销。
import { ArrowDownAZ } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { sortByName } from "./name-sort";
import { type CatalogRow, PanelShell, usePanel } from "./panel-shared";

export const variantBName = "一键重排动作";

export function VariantB({ config }: { config: CatalogAdminConfig }) {
  const panel = usePanel(config);

  function applyNameOrder() {
    const before: CatalogRow[] = panel.rows;
    panel.moveRows(sortByName(before, "asc"));
    toast.success("已按名称 A→Z 重排，顺序即表单下拉的呈现顺序", {
      description: "点击此提示撤销",
      duration: 8000,
      onClick: () => panel.moveRows(before),
    });
  }

  return (
    <PanelShell
      config={config}
      panel={panel}
      rows={panel.rows}
      dragEnabled
      tag={`B · ${variantBName}`}
      hint="拖拽微调，或一键把顺序重排为拼音序（直接覆盖当前顺序）。"
      toolbarExtra={
        <Button
          variant="outline"
          size="sm"
          disabled={panel.rows.length < 2 || panel.reorderPending}
          onClick={applyNameOrder}
        >
          <ArrowDownAZ data-icon="inline-start" />
          按名称排序
        </Button>
      }
    />
  );
}
