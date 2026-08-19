import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { CatalogPanel } from "./CatalogPanel";

export interface VariantProps {
  catalogs: CatalogAdminConfig[];
  stress: boolean;
}

/** A — 标签页：一次只看一个目录，页面长度与目录数量脱钩。 */
export function VariantTabs({ catalogs, stress }: VariantProps) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">字典管理</h1>
        <p className="text-sm text-muted-foreground">
          维护工单可选的目录项；改名全局生效，被工单使用中的目录项只能停用。
        </p>
      </div>
      <Tabs defaultValue={catalogs[0]?.idPrefix ?? ""}>
        <TabsList>
          {catalogs.map((config) => (
            <TabsTrigger key={config.idPrefix} value={config.idPrefix}>
              {config.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {catalogs.map((config) => (
          <TabsContent key={config.idPrefix} value={config.idPrefix} forceMount className="pt-4">
            <CatalogPanel config={config} stress={stress} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
