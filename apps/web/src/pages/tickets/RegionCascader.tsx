import type { RegionNode } from "@insuredesk/shared/region";
import { useEffect, useState } from "react";
import { SearchableCombobox } from "./SearchableCombobox";
import type { AddressFormValue } from "./TicketFormFields";

type RegionModule = typeof import("@insuredesk/shared/region");

let regionModule: Promise<RegionModule> | null = null;

export function loadRegionModule(): Promise<RegionModule> {
  regionModule ??= import("@insuredesk/shared/region");
  return regionModule;
}

export function useRegionModule(): RegionModule | null {
  const [loaded, setLoaded] = useState<RegionModule | null>(null);
  useEffect(() => {
    let live = true;
    void loadRegionModule().then((module) => {
      if (live) setLoaded(module);
    });
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}

function toFormValue(path: readonly RegionNode[]): AddressFormValue | null {
  const [province] = path;
  const leaf = path.at(-1);
  if (!province || !leaf) {
    return null;
  }
  const codeAt = (level: RegionNode["level"]) =>
    path.find((node) => node.level === level)?.code ?? null;
  return {
    provinceCode: province.code,
    cityCode: codeAt("city"),
    districtCode: codeAt("district"),
    complete: leaf.children.length === 0,
  };
}

/** 已存码在当前区划数据中缺失时只提示，不改值。 */
export function RegionCascader({
  id,
  value,
  onChange,
  invalid,
  storedLabel,
}: {
  id: string;
  value: AddressFormValue | null | undefined;
  onChange: (value: AddressFormValue | null) => void;
  invalid?: boolean;
  storedLabel?: string;
}) {
  const regions = useRegionModule();
  if (!regions) {
    return <SearchableCombobox id={id} options={[]} value="" onChange={() => {}} disabled />;
  }

  const codes = value
    ? [value.provinceCode, value.cityCode, value.districtCode].filter((code): code is string =>
        Boolean(code),
      )
    : [];
  const path: RegionNode[] = [];
  let candidates: readonly RegionNode[] = regions.REGION_PROVINCES;
  for (const code of codes) {
    const node = candidates.find((candidate) => candidate.code === code);
    if (!node) break;
    path.push(node);
    candidates = node.children;
  }
  const stale = codes.length > path.length;

  const levels: (readonly RegionNode[])[] = [regions.REGION_PROVINCES];
  for (const node of path) {
    if (node.children.length > 0) levels.push(node.children);
  }

  const select = (index: number, code: string) => {
    const node = levels[index]?.find((candidate) => candidate.code === code);
    onChange(toFormValue(node ? [...path.slice(0, index), node] : path.slice(0, index)));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-2 sm:grid-cols-3">
        {levels.map((options, index) => (
          <SearchableCombobox
            // biome-ignore lint/suspicious/noArrayIndexKey: 级位即身份，换选上级时下级整体重建
            key={index}
            id={index === 0 ? id : `${id}-${index}`}
            options={options.map((node) => ({ id: node.code, name: node.name }))}
            value={path[index]?.code ?? ""}
            onChange={(code) => select(index, code)}
            invalid={invalid}
            placeholder={index === 0 ? "省" : options[0]?.level === "city" ? "市" : "区县"}
          />
        ))}
      </div>
      {stale && storedLabel && (
        <p className="m-0 text-xs text-muted-foreground">
          已存地址「{storedLabel}」不在当前区划数据中，可重新选择
        </p>
      )}
    </div>
  );
}
