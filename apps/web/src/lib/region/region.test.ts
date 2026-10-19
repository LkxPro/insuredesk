import { REGION_PROVINCES, regionLeaves } from "@insuredesk/shared/region";
import { describe, expect, it } from "vitest";
import { loadMapRegionData } from "./index";

describe("地图区划数据", () => {
  it("每个叶子与省级节点都有中国范围内的中心点", async () => {
    const { centers } = await loadMapRegionData();
    for (const node of [...regionLeaves(), ...REGION_PROVINCES]) {
      const center = centers.get(node.code);
      expect(center, node.code).toBeDefined();
      const [lng, lat] = center ?? [0, 0];
      expect(lng >= 73 && lng <= 136 && lat >= 3 && lat <= 54, node.code).toBe(true);
    }
  });

  it("省界底图省份与区划树省级一一对应，含九段线", async () => {
    const { provinces } = await loadMapRegionData();
    const codes = provinces.features.map((feature) => String(feature.properties.adcode));
    expect(codes.filter((code) => /^\d{6}$/.test(code)).sort()).toEqual(
      REGION_PROVINCES.map((province) => province.code).sort(),
    );
    expect(codes).toContain("100000_JD");
  });
});

describe("单省下一级边界", () => {
  it("除台湾外每省都有下级边界；区县的所属市码按前四位推得", async () => {
    const { regionPath } = await import("@insuredesk/shared/region");
    const { cityCodeOf, loadProvinceCityMap } = await import("./index");
    for (const province of REGION_PROVINCES) {
      const map = await loadProvinceCityMap(province.code);
      if (province.code === "710000") {
        expect(map).toBeNull();
        continue;
      }
      const codes = new Set(map?.features.map((feature) => String(feature.properties.adcode)));
      expect([...codes].sort(), province.code).toEqual(
        province.children.map((child) => child.code).sort(),
      );
    }
    for (const leaf of regionLeaves().filter((node) => node.level === "district")) {
      const city = regionPath(leaf.code).find((node) => node.level === "city");
      if (city) expect(cityCodeOf(leaf.code)).toBe(city.code);
    }
  });
});

describe("叶子区划边界", () => {
  it("每个叶子都有边界；中心点基本都落在自身边界内", async () => {
    const { centers, shapes } = await loadMapRegionData();
    const { inShape } = await import("@/pages/ticket-map/map-points");
    const leaves = regionLeaves();
    expect(leaves.every((leaf) => (shapes.get(leaf.code)?.length ?? 0) > 0)).toBe(true);
    const outside = leaves.filter((leaf) => {
      const center = centers.get(leaf.code);
      return center && !inShape(center, shapes.get(leaf.code) ?? []);
    });
    expect(outside.length / leaves.length).toBeLessThan(0.05);
  });

  it("真实边界下，南山区 2000 点、东城区 500 点均不越界", async () => {
    const { centers, shapes } = await loadMapRegionData();
    const { inShape, spiralPoints } = await import("@/pages/ticket-map/map-points");
    for (const [code, count] of [
      ["440305", 2000],
      ["110101", 500],
    ] as const) {
      const shape = shapes.get(code) ?? [];
      const points = spiralPoints(centers.get(code) ?? [0, 0], count, shape);
      expect(points, code).toHaveLength(count);
      expect(
        points.every((point) => inShape(point, shape)),
        code,
      ).toBe(true);
    }
  });
});
