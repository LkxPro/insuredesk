import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { loadRegionModule } from "./RegionCascader";

/** 地区筛选只随工单地图下钻进入列表，没有下拉控件，以可移除标签呈现。 */
export function LocationFilterChip({ code, onRemove }: { code: string; onRemove: () => void }) {
  const [label, setLabel] = useState(code);
  useEffect(() => {
    let live = true;
    void loadRegionModule().then(({ regionPath }) => {
      const path = regionPath(code);
      if (live && path.length > 0) setLabel(path.map((node) => node.name).join(" "));
    });
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <Badge variant="secondary" className="h-8 gap-1 pr-1">
      地区：{label}
      <button
        type="button"
        aria-label="移除地区筛选"
        className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </button>
    </Badge>
  );
}
