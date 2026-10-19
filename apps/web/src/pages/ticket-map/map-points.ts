import type { TicketMapLocation } from "@insuredesk/shared";
import type { LngLat, Ring } from "@/lib/region";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const POINT_SPACING_DEG = 0.03;
export const MAX_SPREAD_RADIUS_DEG = 0.25;

function lngScaleAt(lat: number) {
  return 1 / Math.cos((lat * Math.PI) / 180);
}

function spiralAt(origin: LngLat, spacing: number, index: number, lngScale: number): LngLat {
  const radius = spacing * Math.sqrt(index);
  const angle = index * GOLDEN_ANGLE;
  return [origin[0] + radius * Math.cos(angle) * lngScale, origin[1] + radius * Math.sin(angle)];
}

function inRing([x, y]: LngLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as LngLat;
    const [xj, yj] = ring[j] as LngLat;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inShape(point: LngLat, shape: readonly Ring[]): boolean {
  return shape.some((ring) => inRing(point, ring));
}

/** 面积以纬度度²计（经度按纬度余弦压缩），与螺旋间距同一量纲。 */
function shapeArea(shape: readonly Ring[], lngScale: number): number {
  let total = 0;
  for (const ring of shape) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i] as LngLat;
      const [xj, yj] = ring[j] as LngLat;
      sum += (xj + xi) * (yj - yi);
    }
    total += Math.abs(sum / 2) / lngScale;
  }
  return total;
}

function interiorOrigin(center: LngLat, shape: readonly Ring[], lngScale: number): LngLat {
  if (inShape(center, shape)) return center;
  for (let i = 1; i < 4000; i += 1) {
    const candidate = spiralAt(center, 0.005, i, lngScale);
    if (inShape(candidate, shape)) return candidate;
  }
  return center;
}

/**
 * 只由 (center, count, shape) 决定：同一数据每次渲染位置一致。有边界时只收落在
 * 边界内的螺旋点，按面积收紧间距；收不满（狭长形状）再逐轮缩间距重试。
 */
export function spiralPoints(center: LngLat, count: number, shape?: readonly Ring[]): LngLat[] {
  if (count <= 0) {
    return [];
  }
  const lngScale = lngScaleAt(center[1]);
  if (!shape || shape.length === 0) {
    const spacing =
      count > 1
        ? Math.min(POINT_SPACING_DEG, MAX_SPREAD_RADIUS_DEG / Math.sqrt(count - 1))
        : POINT_SPACING_DEG;
    return Array.from({ length: count }, (_, i) => spiralAt(center, spacing, i, lngScale));
  }

  const origin = interiorOrigin(center, shape, lngScale);
  let spacing = Math.min(
    POINT_SPACING_DEG,
    0.8 * Math.sqrt(shapeArea(shape, lngScale) / (Math.PI * count)),
  );
  let accepted: LngLat[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    accepted = [];
    for (let i = 0; accepted.length < count && i < count * 8 + 64; i += 1) {
      const candidate = spiralAt(origin, spacing, i, lngScale);
      if (inShape(candidate, shape)) accepted.push(candidate);
    }
    if (accepted.length === count) return accepted;
    spacing *= 0.6;
  }
  while (accepted.length < count) accepted.push(origin);
  return accepted;
}

export interface MapPoint {
  readonly value: LngLat;
  readonly code: string;
  readonly provinceCode: string;
  readonly label: string;
  readonly count: number;
}

export interface MapLayout {
  readonly points: MapPoint[];
  readonly provinceCounts: ReadonlyMap<string, number>;
  readonly locatedTotal: number;
}

/** 无中心点的定位码（历史失效码）不画点，同步不计入省份与已定位总数。 */
export function layoutMapPoints(
  locations: readonly TicketMapLocation[],
  centers: ReadonlyMap<string, LngLat>,
  shapes?: ReadonlyMap<string, readonly Ring[]>,
): MapLayout {
  const points: MapPoint[] = [];
  const provinceCounts = new Map<string, number>();
  let locatedTotal = 0;
  for (const location of locations) {
    const center = centers.get(location.code);
    if (!center) {
      continue;
    }
    const label = [location.provinceName, location.cityName, location.districtName]
      .filter(Boolean)
      .join(" ");
    for (const value of spiralPoints(center, location.count, shapes?.get(location.code))) {
      points.push({
        value,
        code: location.code,
        provinceCode: location.provinceCode,
        label,
        count: location.count,
      });
    }
    provinceCounts.set(
      location.provinceCode,
      (provinceCounts.get(location.provinceCode) ?? 0) + location.count,
    );
    locatedTotal += location.count;
  }
  return { points, provinceCounts, locatedTotal };
}

export interface MapFilters {
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  readonly userFeedbackChannelId?: readonly string[] | undefined;
}

export function buildLocationTicketListUrl(code: string, filters: MapFilters): string {
  const params = new URLSearchParams({ locationCode: code });
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.userFeedbackChannelId && filters.userFeedbackChannelId.length > 0) {
    params.set("userFeedbackChannel", filters.userFeedbackChannelId.join(","));
  }
  return `/tickets?${params.toString()}`;
}
