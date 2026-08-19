import { Settings2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { CatalogPanel } from "./CatalogPanel";
import type { VariantProps } from "./VariantTabs";

function CatalogCard({ config, onManage }: { config: CatalogAdminConfig; onManage: () => void }) {
  const list = config.hooks.useList();
  const rows = list.data ?? [];
  const preview = rows
    .slice(0, 3)
    .map((row) => row.name)
    .join("、");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {config.title}
          <Badge variant="secondary">{list.data ? rows.length : "…"}</Badge>
        </CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onManage}>
            <Settings2 data-icon="inline-start" />
            管理
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="truncate text-sm text-muted-foreground">
          {preview || config.emptyDescription}
          {rows.length > 3 ? ` 等 ${rows.length} 项` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

/** C — 卡片总览：页面只放目录卡片与前几项预览，管理动作收进右侧抽屉。 */
export function VariantCards({ catalogs, stress }: VariantProps) {
  const [managing, setManaging] = useState<CatalogAdminConfig | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">字典管理</h1>
        <p className="text-sm text-muted-foreground">
          维护工单可选的目录项；改名全局生效，被工单使用中的目录项只能停用。
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {catalogs.map((config) => (
          <CatalogCard key={config.idPrefix} config={config} onManage={() => setManaging(config)} />
        ))}
      </div>

      <Sheet open={managing !== null} onOpenChange={(open) => !open && setManaging(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {managing && (
            <>
              <SheetHeader>
                <SheetTitle>{managing.title}</SheetTitle>
                <SheetDescription className="sr-only">{managing.subtitle}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <CatalogPanel config={managing} stress={stress} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
