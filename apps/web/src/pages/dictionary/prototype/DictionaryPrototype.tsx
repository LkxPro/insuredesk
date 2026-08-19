import { useState } from "react";
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { PrototypeSwitcher } from "./PrototypeSwitcher";
import { VariantCards } from "./VariantCards";
import { VariantSidebar } from "./VariantSidebar";
import { VariantTabs } from "./VariantTabs";

/**
 * 原型（随用随弃）：回答「/dictionary 目录一多列表过长怎么组织 + 拖拽排序的手感」。
 * 三个结构不同的变体挂在现有 /dictionary 路由上，?variant=A|B|C 切换：
 * A=标签页，B=侧边导航 master-detail，C=卡片总览+抽屉管理。
 * 拖拽仅本地重排不落库；切换条上的「数据量」开关把每个目录垫到 24 条以模拟长列表。
 */
const VARIANTS = [
  { key: "A", name: "标签页" },
  { key: "B", name: "侧边导航" },
  { key: "C", name: "卡片总览" },
];

export function DictionaryPrototype({
  variant,
  catalogs,
}: {
  variant: string;
  catalogs: CatalogAdminConfig[];
}) {
  const [stress, setStress] = useState(true);

  return (
    <>
      {variant === "B" ? (
        <VariantSidebar catalogs={catalogs} stress={stress} />
      ) : variant === "C" ? (
        <VariantCards catalogs={catalogs} stress={stress} />
      ) : (
        <VariantTabs catalogs={catalogs} stress={stress} />
      )}
      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        stress={stress}
        onToggleStress={() => setStress((current) => !current)}
      />
    </>
  );
}
