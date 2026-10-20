import { REGION_PROVINCES } from "@insuredesk/shared/region";
import { describe, expect, it } from "vitest";
import { flattenRegionPaths, regionPathLabel, searchRegionPaths } from "./region-search";

const PATHS = flattenRegionPaths(REGION_PROVINCES);
const labels = (query: string) => searchRegionPaths(query, PATHS).map(regionPathLabel);

describe("地区检索", () => {
  it("省 / 省市 / 省市区三级全称都能精确命中，且排在首位", () => {
    expect(labels("广东省")[0]).toBe("广东省");
    expect(labels("广东省深圳市")[0]).toBe("广东省 深圳市");
    expect(labels("广东省深圳市南山区")).toEqual(["广东省 深圳市 南山区"]);
    expect(labels("北京市朝阳区")).toEqual(["北京市 朝阳区"]);
  });

  it("只匹配止于末级的路径：搜省不带出全省市县", () => {
    expect(labels("广东省")).toEqual(["广东省"]);
    expect(labels("深圳")).toEqual(["广东省 深圳市"]);
  });

  it("可省略后缀、省略上级、加分隔符", () => {
    expect(labels("广东深圳南山")).toEqual(["广东省 深圳市 南山区"]);
    expect(labels("深圳 南山区")).toEqual(["广东省 深圳市 南山区"]);
    expect(labels("广东/深圳")[0]).toBe("广东省 深圳市");
  });

  it("同名区县都列出，加上级即可区分", () => {
    const chaoyang = labels("朝阳区");
    expect(chaoyang).toContain("北京市 朝阳区");
    expect(chaoyang).toContain("吉林省 长春市 朝阳区");
    expect(labels("长春朝阳")).toEqual(["吉林省 长春市 朝阳区"]);
  });

  it("支持拼音与首字母", () => {
    expect(labels("guangdong")[0]).toBe("广东省");
    expect(labels("gd sz")).toContain("广东省 深圳市");
  });

  it("无匹配返回空", () => {
    expect(labels("火星")).toEqual([]);
    expect(labels("  ")).toEqual([]);
  });
});
