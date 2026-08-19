import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { CatalogPanel } from "./CatalogPanel";
import type { VariantProps } from "./VariantTabs";

function NavItem({
  config,
  selected,
  onSelect,
}: {
  config: CatalogAdminConfig;
  selected: boolean;
  onSelect: () => void;
}) {
  const list = config.hooks.useList();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
        selected ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      <span className="truncate">{config.title}</span>
      <Badge variant="secondary">{list.data?.length ?? "…"}</Badge>
    </button>
  );
}

/** B — 侧边导航：左栏目录索引（带条目数），右栏 master-detail 管理当前目录。 */
export function VariantSidebar({ catalogs, stress }: VariantProps) {
  const [selected, setSelected] = useState(catalogs[0]?.idPrefix ?? "");
  const current = catalogs.find((c) => c.idPrefix === selected) ?? catalogs[0];
  if (!current) return null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">字典管理</h1>
        <p className="text-sm text-muted-foreground">
          维护工单可选的目录项；改名全局生效，被工单使用中的目录项只能停用。
        </p>
      </div>
      <div className="flex items-start gap-8">
        <aside className="sticky top-6 w-52 shrink-0">
          <nav className="flex flex-col gap-1">
            {catalogs.map((config) => (
              <NavItem
                key={config.idPrefix}
                config={config}
                selected={config.idPrefix === selected}
                onSelect={() => setSelected(config.idPrefix)}
              />
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          {catalogs.map((config) => (
            <div key={config.idPrefix} hidden={config.idPrefix !== current.idPrefix}>
              <h2 className="mb-3 text-lg font-semibold">{config.title}</h2>
              <CatalogPanel config={config} stress={stress} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
