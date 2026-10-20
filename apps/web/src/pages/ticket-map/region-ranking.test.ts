import type { TicketMapLocation } from "@insuredesk/shared";
import { findRegion, regionPath } from "@insuredesk/shared/region";
import { describe, expect, it } from "vitest";
import { buildRegionRanking, type RankLevel, rankLevelsFor } from "./region-ranking";
import type { RegionPath } from "./region-search";

function at(code: string, count: number): TicketMapLocation {
  return {
    code,
    provinceCode: `${code.slice(0, 2)}0000`,
    provinceName: "",
    cityName: null,
    districtName: null,
    count,
  };
}

const LOCATIONS = [
  at("440305", 3),
  at("440304", 1),
  at("440106", 1),
  at("441900", 2),
  at("110105", 4),
  at("220104", 1),
  at("710000", 1),
  at("440399", 9),
];

const scope = (...codes: string[]): RegionPath =>
  codes.map((code) => findRegion(code)).filter((node) => node !== undefined);

function rank(level: RankLevel, ...scopeCodes: string[]) {
  return buildRegionRanking(
    LOCATIONS,
    level,
    scope(...scopeCodes),
    regionPath,
    (code) => code !== "440399",
  );
}

const summary = (level: RankLevel, ...scopeCodes: string[]) =>
  rank(level, ...scopeCodes).rows.map((row) =>
    [row.rank, row.parentLabel, row.name, row.count].filter(Boolean).join(" "),
  );

describe("地区排名", () => {
  it("全国省排名：无坐标码不计入", () => {
    expect(summary("province")).toEqual(["1 广东省 7", "2 北京市 4", "3 吉林省 1", "3 台湾省 1"]);
  });

  it("全国市排名：直辖市以自身计入，同数并列；台湾没有市级计为未计入", () => {
    const ranking = rank("city");
    expect(summary("city")).toEqual([
      "1 北京市 4",
      "1 广东省 深圳市 4",
      "3 广东省 东莞市 2",
      "4 吉林省 长春市 1",
      "4 广东省 广州市 1",
    ]);
    expect(ranking.excluded).toBe(1);
    expect(ranking.total).toBe(12);
  });

  it("全国区县排名：同名区县带上级区分；东莞、台湾计为未计入", () => {
    const ranking = rank("district");
    expect(summary("district")).toEqual([
      "1 北京市 朝阳区 4",
      "2 广东省 深圳市 南山区 3",
      "3 吉林省 长春市 朝阳区 1",
      "3 广东省 广州市 天河区 1",
      "3 广东省 深圳市 福田区 1",
    ]);
    expect(ranking.excluded).toBe(3);
  });

  it("省、市视图只排本区域，上级标签不重复视图已限定的部分", () => {
    expect(summary("city", "440000")).toEqual(["1 深圳市 4", "2 东莞市 2", "3 广州市 1"]);
    expect(summary("district", "440000")).toEqual([
      "1 深圳市 南山区 3",
      "2 广州市 天河区 1",
      "2 深圳市 福田区 1",
    ]);
    expect(summary("district", "440000", "440300")).toEqual(["1 南山区 3", "2 福田区 1"]);
  });

  it("可选层级：只能比视图更细；直辖市视图不给市，台湾退回自身", () => {
    expect(rankLevelsFor(scope())).toEqual(["province", "city", "district"]);
    expect(rankLevelsFor(scope("440000"))).toEqual(["city", "district"]);
    expect(rankLevelsFor(scope("110000"))).toEqual(["district"]);
    expect(rankLevelsFor(scope("440000", "440300"))).toEqual(["district"]);
    expect(rankLevelsFor(scope("710000"))).toEqual(["province"]);
  });

  it("只有叶子区划标记可跳转工单列表", () => {
    const rows = rank("city").rows;
    expect(rows.find((row) => row.code === "441900")?.leaf).toBe(true);
    expect(rows.find((row) => row.code === "440300")?.leaf).toBe(false);
    expect(rows.find((row) => row.code === "110000")?.leaf).toBe(false);
  });
});
