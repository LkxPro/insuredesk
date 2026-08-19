// 原型（可丢弃）：字典抽屉「按名称排序」的三个 UI 变体，/dictionary?variant=A|B|C 切换。
// 待回答的问题：目录顺序 = 手动拖拽（即表单下拉呈现顺序）时，名称排序该长什么样、
// 与手动顺序是什么关系——A 纯视图排序不动真实顺序；B 一键重排直接覆盖（可撤销）；
// C 名称序仅预览，显式保存才覆盖。选定后此目录整体删除，胜出版本重写进 CatalogAdmin。
import type { CatalogAdminConfig } from "../CatalogAdmin";
import { VariantA, variantAName } from "./VariantA";
import { VariantB, variantBName } from "./VariantB";
import { VariantC, variantCName } from "./VariantC";

export const PROTOTYPE_VARIANTS = [
  { key: "A", name: variantAName },
  { key: "B", name: variantBName },
  { key: "C", name: variantCName },
];

export function PrototypeCatalogAdmin({
  config,
  variant,
}: {
  config: CatalogAdminConfig;
  variant: string;
}) {
  if (variant === "B") return <VariantB config={config} />;
  if (variant === "C") return <VariantC config={config} />;
  return <VariantA config={config} />;
}
