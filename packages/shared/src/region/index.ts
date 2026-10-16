import type { TicketAddress, TicketAddressCodes } from "../ticket-address.ts";
import { REGION_ROWS_TEXT } from "./region-data.ts";

export type RegionLevel = "province" | "city" | "district";

export interface RegionNode {
  readonly code: string;
  readonly name: string;
  readonly level: RegionLevel;
  readonly parentCode: string | null;
  readonly children: readonly RegionNode[];
}

const LEVELS: Record<string, RegionLevel> = { p: "province", c: "city", d: "district" };

interface MutableRegionNode extends RegionNode {
  readonly children: RegionNode[];
}

function parseRegions() {
  const byCode = new Map<string, MutableRegionNode>();
  const provinces: MutableRegionNode[] = [];
  for (const line of REGION_ROWS_TEXT.split("\n")) {
    if (!line) {
      continue;
    }
    const [code = "", name = "", parentCode = "", levelKey = ""] = line.split(",");
    const level = LEVELS[levelKey];
    if (!level) {
      throw new Error(`区划数据层级无效：${line}`);
    }
    const node: MutableRegionNode = {
      code,
      name,
      level,
      parentCode: parentCode || null,
      children: [],
    };
    byCode.set(code, node);
    if (node.parentCode === null) {
      provinces.push(node);
    } else {
      const parent = byCode.get(node.parentCode);
      if (!parent) {
        throw new Error(`区划数据上级缺失：${line}`);
      }
      parent.children.push(node);
    }
  }
  return { byCode, provinces };
}

const { byCode, provinces } = parseRegions();

export const REGION_PROVINCES: readonly RegionNode[] = provinces;

export function findRegion(code: string): RegionNode | undefined {
  return byCode.get(code);
}

export function regionPath(code: string): RegionNode[] {
  const path: RegionNode[] = [];
  let node = byCode.get(code);
  while (node) {
    path.unshift(node);
    node = node.parentCode === null ? undefined : byCode.get(node.parentCode);
  }
  return path;
}

export function regionLeaves(): RegionNode[] {
  return [...byCode.values()].filter((node) => node.children.length === 0);
}

/**
 * 合法地址 = 区划树中从省到某个叶子的完整路径，各级码按节点 level 归位：
 * 直辖市/港澳无市级（city 为空），市级叶子无区县，台湾只有省。
 */
export function resolveRegionAddress(codes: TicketAddressCodes): TicketAddress | null {
  const leafCode = codes.districtCode ?? codes.cityCode ?? codes.provinceCode;
  const leaf = byCode.get(leafCode);
  if (!leaf || leaf.children.length > 0) {
    return null;
  }
  const slot = (level: RegionLevel) => regionPath(leafCode).find((node) => node.level === level);
  const province = slot("province");
  const city = slot("city");
  const district = slot("district");
  if (
    province?.code !== codes.provinceCode ||
    (city?.code ?? null) !== codes.cityCode ||
    (district?.code ?? null) !== codes.districtCode
  ) {
    return null;
  }
  return {
    provinceCode: province.code,
    provinceName: province.name,
    cityCode: city?.code ?? null,
    cityName: city?.name ?? null,
    districtCode: district?.code ?? null,
    districtName: district?.name ?? null,
  };
}
