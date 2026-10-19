import type { TicketMapLocation } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import {
  buildLocationTicketListUrl,
  inShape,
  layoutMapPoints,
  MAX_SPREAD_RADIUS_DEG,
  spiralPoints,
} from "./map-points";

const CENTER = [113.9294, 22.5312] as const;

function radiusDeg([lng, lat]: readonly [number, number]) {
  const lngScale = Math.cos((CENTER[1] * Math.PI) / 180);
  return Math.hypot((lng - CENTER[0]) * lngScale, lat - CENTER[1]);
}

describe("spiralPoints", () => {
  it("点数 = count，同一输入结果一致", () => {
    expect(spiralPoints(CENTER, 0)).toEqual([]);
    expect(spiralPoints(CENTER, 1)).toEqual([CENTER]);
    expect(spiralPoints(CENTER, 37)).toHaveLength(37);
    expect(spiralPoints(CENTER, 37)).toEqual(spiralPoints(CENTER, 37));
  });

  it.each([2, 50, 5000])("%i 点都在最大半径内且互不重合", (count) => {
    const points = spiralPoints(CENTER, count);
    for (const point of points) {
      expect(radiusDeg(point)).toBeLessThanOrEqual(MAX_SPREAD_RADIUS_DEG + 1e-9);
    }
    expect(new Set(points.map((point) => point.join(","))).size).toBe(count);
  });
});

describe("layoutMapPoints", () => {
  const location = (code: string, provinceCode: string, count: number): TicketMapLocation => ({
    code,
    provinceCode,
    provinceName: "广东省",
    cityName: "深圳市",
    districtName: "南山区",
    count,
  });

  it("按 count 展开点；省份计数与已定位总数只算有坐标的定位码", () => {
    const layout = layoutMapPoints(
      [location("440305", "440000", 3), location("440399", "440000", 5)],
      new Map([["440305", CENTER]]),
    );
    expect(layout.points).toHaveLength(3);
    expect(layout.points[0]).toMatchObject({
      code: "440305",
      label: "广东省 深圳市 南山区",
      count: 3,
    });
    expect(layout.provinceCounts.get("440000")).toBe(3);
    expect(layout.locatedTotal).toBe(3);
  });
});

describe("buildLocationTicketListUrl", () => {
  it("携带定位码与地图当前筛选", () => {
    const url = new URL(
      buildLocationTicketListUrl("440305", {
        createdFrom: "2026-07-18T16:00:00.000Z",
        createdTo: "2026-10-16T15:59:59.999Z",
        userFeedbackChannelId: ["ufc-1", "ufc-2"],
      }),
      "http://localhost",
    );
    expect(url.pathname).toBe("/tickets");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      locationCode: "440305",
      createdFrom: "2026-07-18T16:00:00.000Z",
      createdTo: "2026-10-16T15:59:59.999Z",
      userFeedbackChannel: "ufc-1,ufc-2",
    });
  });

  it("未筛选时只带定位码", () => {
    expect(buildLocationTicketListUrl("110105", {})).toBe("/tickets?locationCode=110105");
  });
});

describe("spiralPoints 边界约束", () => {
  const square = [
    [
      [113.9, 22.5],
      [114.0, 22.5],
      [114.0, 22.6],
      [113.9, 22.6],
    ],
  ] as const;
  const strip = [
    [
      [100.0, 30.0],
      [101.0, 30.0],
      [101.0, 30.02],
      [100.0, 30.02],
    ],
  ] as const;

  it.each([1, 30, 2000])("%i 点全部落在边界内、数量准确、互不重合", (count) => {
    const points = spiralPoints([113.95, 22.55], count, square);
    expect(points).toHaveLength(count);
    expect(points.every((point) => inShape(point, square))).toBe(true);
    expect(new Set(points.map((point) => point.join(","))).size).toBe(count);
  });

  it("狭长形状同样收满且不越界", () => {
    const points = spiralPoints([100.5, 30.01], 300, strip);
    expect(points).toHaveLength(300);
    expect(points.every((point) => inShape(point, strip))).toBe(true);
  });

  it("中心点在边界外时先找到边界内的起点", () => {
    const points = spiralPoints([113.85, 22.55], 20, square);
    expect(points.every((point) => inShape(point, square))).toBe(true);
  });
});
