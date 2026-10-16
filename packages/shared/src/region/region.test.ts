import { describe, expect, it } from "vitest";
import { ticketAddressLocationCode } from "../ticket-address.ts";
import { findRegion, REGION_PROVINCES, regionLeaves, resolveRegionAddress } from "./index.ts";

describe("区划树", () => {
  it("34 个省级单位齐全，码唯一", () => {
    expect(REGION_PROVINCES).toHaveLength(34);
    expect(new Set(REGION_PROVINCES.map((province) => province.code)).size).toBe(34);
  });

  it("东莞/中山/儋州/嘉峪关/济源是市级叶子", () => {
    for (const code of ["441900", "442000", "460400", "620200", "419001"]) {
      const node = findRegion(code);
      expect(node?.level).toBe("city");
      expect(node?.children).toHaveLength(0);
    }
  });

  it("京津沪渝港澳下直接是区县", () => {
    for (const code of ["110000", "120000", "310000", "500000", "810000", "820000"]) {
      const children = findRegion(code)?.children ?? [];
      expect(children.length).toBeGreaterThan(0);
      expect(children.every((child) => child.level === "district")).toBe(true);
    }
  });

  it("台湾是省级叶子", () => {
    expect(findRegion("710000")?.children).toHaveLength(0);
  });

  it("北京朝阳区与长春朝阳区码不同", () => {
    const chaoyang = regionLeaves().filter((leaf) => leaf.name === "朝阳区");
    expect(chaoyang.map((leaf) => leaf.code).sort()).toEqual(["110105", "220104"]);
  });
});

describe("resolveRegionAddress", () => {
  it("省/市/区县三级", () => {
    expect(
      resolveRegionAddress({ provinceCode: "440000", cityCode: "440300", districtCode: "440305" }),
    ).toEqual({
      provinceCode: "440000",
      provinceName: "广东省",
      cityCode: "440300",
      cityName: "深圳市",
      districtCode: "440305",
      districtName: "南山区",
    });
  });

  it("直辖市省/区县两级，city 为空", () => {
    expect(
      resolveRegionAddress({ provinceCode: "110000", cityCode: null, districtCode: "110105" }),
    ).toMatchObject({ provinceName: "北京市", cityCode: null, districtName: "朝阳区" });
  });

  it("市级叶子省/市两级", () => {
    expect(
      resolveRegionAddress({ provinceCode: "440000", cityCode: "441900", districtCode: null }),
    ).toMatchObject({ cityName: "东莞市", districtCode: null });
  });

  it("台湾仅省", () => {
    expect(
      resolveRegionAddress({ provinceCode: "710000", cityCode: null, districtCode: null }),
    ).toMatchObject({ provinceName: "台湾省", cityCode: null, districtCode: null });
  });

  it.each([
    ["未到叶子：只选省", { provinceCode: "440000", cityCode: null, districtCode: null }],
    [
      "未到叶子：只选到有下级的市",
      { provinceCode: "440000", cityCode: "440300", districtCode: null },
    ],
    ["上下级不匹配", { provinceCode: "440000", cityCode: "440100", districtCode: "440305" }],
    ["省码不匹配", { provinceCode: "110000", cityCode: "440300", districtCode: "440305" }],
    ["直辖市多填了 city", { provinceCode: "110000", cityCode: "110000", districtCode: "110105" }],
    ["不存在的码", { provinceCode: "440000", cityCode: "440300", districtCode: "440399" }],
  ])("%s 拒绝", (_label, codes) => {
    expect(resolveRegionAddress(codes)).toBeNull();
  });

  it("每个叶子从路径反推都合法，定位码即叶子码", () => {
    for (const leaf of regionLeaves()) {
      const province = leaf.level === "province" ? leaf : undefined;
      const parent = leaf.parentCode ? findRegion(leaf.parentCode) : undefined;
      const codes = province
        ? { provinceCode: leaf.code, cityCode: null, districtCode: null }
        : leaf.level === "city"
          ? { provinceCode: leaf.parentCode ?? "", cityCode: leaf.code, districtCode: null }
          : parent?.level === "province"
            ? { provinceCode: parent.code, cityCode: null, districtCode: leaf.code }
            : {
                provinceCode: parent?.parentCode ?? "",
                cityCode: parent?.code ?? null,
                districtCode: leaf.code,
              };
      const resolved = resolveRegionAddress(codes);
      expect(resolved, leaf.code).not.toBeNull();
      expect(resolved && ticketAddressLocationCode(resolved)).toBe(leaf.code);
    }
  });
});
