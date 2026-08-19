// 原型（可丢弃）变体 A：点「名称」表头循环 升序→降序→恢复，纯视图排序，不动真实顺序。
import { ArrowDownAZ, ArrowUpDown, ArrowUpZA } from "lucide-react";
import { useState } from "react";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { type NameSortDir, sortByName } from "./name-sort";
import { PanelShell, usePanel } from "./panel-shared";

export const variantAName = "表头视图排序";

export function VariantA({ config }: { config: CatalogAdminConfig }) {
  const panel = usePanel(config);
  const [dir, setDir] = useState<NameSortDir | "off">("off");

  const rows = dir === "off" ? panel.rows : sortByName(panel.rows, dir);

  return (
    <PanelShell
      config={config}
      panel={panel}
      rows={rows}
      dragEnabled={dir === "off"}
      tag={`A · ${variantAName}`}
      hint={
        dir === "off"
          ? "拖拽行首手柄调整顺序；点「名称」表头可按名称预览。"
          : "按名称预览中，不影响表单下拉的真实顺序；再点表头恢复手动顺序。"
      }
      nameHead={
        <button
          type="button"
          aria-label="按名称排序"
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() =>
            setDir((current) => (current === "off" ? "asc" : current === "asc" ? "desc" : "off"))
          }
        >
          名称
          {dir === "asc" ? (
            <ArrowDownAZ className="size-4 text-foreground" />
          ) : dir === "desc" ? (
            <ArrowUpZA className="size-4 text-foreground" />
          ) : (
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
          )}
        </button>
      }
    />
  );
}
