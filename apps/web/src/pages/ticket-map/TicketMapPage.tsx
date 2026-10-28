import type { CreatedRangeQuery, TicketMapLocation } from "@insuredesk/shared";
import type { RegionNode } from "@insuredesk/shared/region";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { AlertCircle, ArrowLeft, RotateCcw, Tags } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { useAuth } from "@/contexts/AuthContext";
import {
  type ChinaProvincesGeoJson,
  cityCodeOf,
  loadCityDistrictMap,
  loadMapRegionData,
  loadProvinceCityMap,
  type MapRegionData,
} from "@/lib/region";
import { trpc } from "@/lib/trpc";
import { CreatedRangeFilter } from "@/pages/ticket-surface/CreatedRangeFilter";
import { MultiSelectFilter } from "@/pages/ticket-surface/MultiSelectFilter";
import { useRegionModule } from "@/pages/tickets/RegionCascader";
import { buildLocationTicketListUrl, layoutMapPoints } from "./map-points";
import { RegionRanking } from "./RegionRanking";
import { RegionSearch } from "./RegionSearch";
import { buildRegionRanking, type RankLevel, rankLevelsFor } from "./region-ranking";
import type { RegionPath } from "./region-search";
import type { MapArea } from "./TicketMapChart";

const TicketMapChart = lazy(() =>
  import("./TicketMapChart").then((m) => ({ default: m.TicketMapChart })),
);

const DEFAULT_RANGE_DAYS = 90;

/** 直辖市与港澳的下一级是区县，没有市。 */
const DISTRICT_CHILD_PROVINCES = new Set([
  "110000",
  "120000",
  "310000",
  "500000",
  "810000",
  "820000",
]);

function areaLabelNoun(provinceCode: string | null): string {
  if (provinceCode === null) return "省名";
  return DISTRICT_CHILD_PROVINCES.has(provinceCode) ? "区名" : "市名";
}

interface FocusCity {
  readonly provinceCode: string;
  readonly code: string;
  readonly name: string;
  readonly geoJson: ChinaProvincesGeoJson;
}

function defaultRange(now: Date = new Date()): CreatedRangeQuery {
  return {
    createdFrom: startOfDay(subDays(now, DEFAULT_RANGE_DAYS - 1)).toISOString(),
    createdTo: endOfDay(now).toISOString(),
  };
}

function mockLocations(total: number, data: MapRegionData): TicketMapLocation[] {
  const codes = [...data.centers.keys()].filter((code) => !code.endsWith("0000"));
  const locations: TicketMapLocation[] = [];
  let remaining = total;
  for (let i = 0; remaining > 0 && codes.length > 0; i += 1) {
    const code = codes[(i * 7919) % codes.length] as string;
    const count = Math.min(remaining, 1 + ((i * 31) % 40));
    remaining -= count;
    locations.push({
      code,
      provinceCode: `${code.slice(0, 2)}0000`,
      provinceName: `模拟 ${code.slice(0, 2)}`,
      cityName: null,
      districtName: code,
      count,
    });
  }
  return locations;
}

function useMapRegionData() {
  const [data, setData] = useState<MapRegionData | null>(null);
  useEffect(() => {
    let live = true;
    void loadMapRegionData().then((loaded) => {
      if (live) setData(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  return data;
}

export function TicketMapPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState<CreatedRangeQuery>(() => defaultRange());
  const [userFeedbackChannelId, setUserFeedbackChannelId] = useState<string[]>([]);
  const [resetToken, setResetToken] = useState(0);
  const [focusProvinceCode, setFocusProvinceCode] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const regionData = useMapRegionData();

  const filters = useMemo(
    () => ({
      ...range,
      ...(userFeedbackChannelId.length > 0 && { userFeedbackChannelId }),
    }),
    [range, userFeedbackChannelId],
  );
  const pointsQuery = trpc.ticketMap.points.useQuery(filters, {
    staleTime: 0,
    refetchOnMount: "always",
  });
  const channelOptions = trpc.userFeedbackChannel.filterOptions.useQuery().data ?? [];
  const channels = useMemo(
    () =>
      channelOptions.map((channel) => ({
        value: channel.id,
        label: channel.active ? channel.name : `${channel.name}（已停用）`,
      })),
    [channelOptions],
  );

  const mockTotal = import.meta.env.DEV ? Number(searchParams.get("mock")) || 0 : 0;
  const locations = useMemo(() => {
    if (mockTotal > 0 && regionData) return mockLocations(mockTotal, regionData);
    return pointsQuery.data ?? [];
  }, [mockTotal, regionData, pointsQuery.data]);

  const layout = useMemo(
    () => (regionData ? layoutMapPoints(locations, regionData.centers, regionData.shapes) : null),
    [locations, regionData],
  );

  const focusProvinceName = focusProvinceCode
    ? (regionData?.provinces.features.find(
        (feature) => String(feature.properties.adcode) === focusProvinceCode,
      )?.properties.name ?? null)
    : null;

  const [cityMap, setCityMap] = useState<{
    provinceCode: string;
    geoJson: ChinaProvincesGeoJson | null;
  } | null>(null);
  useEffect(() => {
    if (!focusProvinceCode) return;
    let live = true;
    void loadProvinceCityMap(focusProvinceCode).then((geoJson) => {
      if (live) setCityMap({ provinceCode: focusProvinceCode, geoJson });
    });
    return () => {
      live = false;
    };
  }, [focusProvinceCode]);

  const [focusCity, setFocusCity] = useState<FocusCity | null>(null);
  const activeCity = focusCity?.provinceCode === focusProvinceCode ? focusCity : null;
  const canDrillCity =
    focusProvinceCode !== null &&
    activeCity === null &&
    !DISTRICT_CHILD_PROVINCES.has(focusProvinceCode);

  // 地区检索定位到的末级（区县、市级叶子或省视图里的市）：底图与排名高亮，不另行过滤
  const [highlightCode, setHighlightCode] = useState<string | null>(null);

  const focusProvince = useCallback((code: string | null) => {
    setFocusCity(null);
    setHighlightCode(null);
    setFocusProvinceCode(code);
  }, []);

  const enterCity = useCallback(
    async (provinceCode: string, code: string, name: string): Promise<boolean> => {
      const geoJson = await loadCityDistrictMap(code);
      if (!geoJson) return false;
      setHighlightCode(null);
      setFocusProvinceCode(provinceCode);
      setFocusCity({ provinceCode, code, name, geoJson });
      return true;
    },
    [],
  );

  const drillCity = useCallback(
    (code: string): Promise<boolean> => {
      if (!focusProvinceCode) return Promise.resolve(false);
      const name =
        cityMap?.geoJson?.features.find((feature) => String(feature.properties.adcode) === code)
          ?.properties.name ?? code;
      return enterCity(focusProvinceCode, code, name);
    },
    [focusProvinceCode, cityMap, enterCity],
  );

  const onRegionSelect = useCallback(
    async (path: RegionPath) => {
      const [province] = path;
      const leaf = path.at(-1);
      if (!province || !leaf) return;
      const city = path.find((node) => node.level === "city");
      if (city && (await enterCity(province.code, city.code, city.name))) {
        setHighlightCode(leaf === city ? null : leaf.code);
        return;
      }
      focusProvince(province.code);
      setHighlightCode(leaf === province ? null : leaf.code);
    },
    [enterCity, focusProvince],
  );

  const searchValue = [focusProvinceCode, activeCity?.code, highlightCode].filter(
    (code): code is string => Boolean(code),
  );

  const area = useMemo((): MapArea | null => {
    if (!regionData || !layout) return null;
    if (!focusProvinceCode) {
      return { areaCode: null, geoJson: regionData.provinces, counts: layout.provinceCounts };
    }
    if (activeCity) {
      const districtCodes = new Set(
        activeCity.geoJson.features.map((feature) => String(feature.properties.adcode)),
      );
      const counts = new Map<string, number>();
      for (const location of locations) {
        if (
          cityCodeOf(location.code) !== activeCity.code ||
          !regionData.centers.has(location.code)
        ) {
          continue;
        }
        const key = districtCodes.has(location.code) ? location.code : activeCity.code;
        counts.set(key, (counts.get(key) ?? 0) + location.count);
      }
      return { areaCode: activeCity.code, geoJson: activeCity.geoJson, counts };
    }
    if (cityMap?.provinceCode !== focusProvinceCode) return null;
    const geoJson = cityMap.geoJson ?? {
      ...regionData.provinces,
      features: regionData.provinces.features.filter(
        (feature) => String(feature.properties.adcode) === focusProvinceCode,
      ),
    };
    const areaCodes = new Set(geoJson.features.map((feature) => String(feature.properties.adcode)));
    const counts = new Map<string, number>();
    for (const location of locations) {
      if (location.provinceCode !== focusProvinceCode || !regionData.centers.has(location.code)) {
        continue;
      }
      const key = areaCodes.has(location.code)
        ? location.code
        : areaCodes.has(cityCodeOf(location.code))
          ? cityCodeOf(location.code)
          : focusProvinceCode;
      counts.set(key, (counts.get(key) ?? 0) + location.count);
    }
    return { areaCode: focusProvinceCode, geoJson, counts };
  }, [regionData, layout, focusProvinceCode, activeCity, cityMap, locations]);

  const visiblePoints = useMemo(() => {
    if (!activeCity) return [];
    return (layout?.points ?? []).filter((point) => cityCodeOf(point.code) === activeCity.code);
  }, [layout, activeCity]);
  const visibleTotal = activeCity
    ? [...(area?.counts.values() ?? [])].reduce((sum, count) => sum + count, 0)
    : focusProvinceCode
      ? (layout?.provinceCounts.get(focusProvinceCode) ?? 0)
      : (layout?.locatedTotal ?? 0);

  const canDrill = hasPermission("ticket.view");
  const onPointClick = useMemo(
    () =>
      canDrill ? (code: string) => navigate(buildLocationTicketListUrl(code, filters)) : undefined,
    [canDrill, navigate, filters],
  );

  const regions = useRegionModule();
  const rankScope = useMemo(
    () =>
      regions
        ? [focusProvinceCode, activeCity?.code]
            .map((code) => (code ? regions.findRegion(code) : undefined))
            .filter((node): node is RegionNode => node !== undefined)
        : [],
    [regions, focusProvinceCode, activeCity],
  );
  const rankLevels = rankLevelsFor(rankScope);
  const [preferredRankLevel, setPreferredRankLevel] = useState<RankLevel | null>(null);
  const rankLevel =
    preferredRankLevel && rankLevels.includes(preferredRankLevel)
      ? preferredRankLevel
      : (rankLevels[0] as RankLevel);
  const ranking = useMemo(
    () =>
      regions && regionData
        ? buildRegionRanking(locations, rankLevel, rankScope, regions.regionPath, (code) =>
            regionData.centers.has(code),
          )
        : { rows: [], total: 0, excluded: 0 },
    [regions, regionData, locations, rankLevel, rankScope],
  );

  const onAreaDoubleClick = !focusProvinceCode
    ? focusProvince
    : canDrillCity
      ? (code: string) => void drillCity(code)
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            工单地图{focusProvinceName && ` · ${focusProvinceName}`}
            {activeCity && ` · ${activeCity.name}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            按工单地址展示分布，每个红点为一例工单；双击省份看该省市界，再双击市看区县，也可在排名卡片里搜索地区。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreatedRangeFilter range={range} onChange={setRange} />
          <MultiSelectFilter
            label="用户反馈渠道"
            values={userFeedbackChannelId}
            options={channels}
            onChange={setUserFeedbackChannelId}
          />
          <Badge variant="secondary" className="h-8 tabular-nums">
            已定位 {visibleTotal} 例
          </Badge>
          {activeCity ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFocusCity(null);
                setHighlightCode(null);
              }}
            >
              <ArrowLeft data-icon="inline-start" />
              返回{focusProvinceName ?? "全省"}
            </Button>
          ) : (
            focusProvinceCode && (
              <Button variant="outline" size="sm" onClick={() => focusProvince(null)}>
                <ArrowLeft data-icon="inline-start" />
                返回全国
              </Button>
            )
          )}
          <Toggle
            variant="outline"
            size="sm"
            pressed={showLabels}
            onPressedChange={setShowLabels}
            className="px-3"
          >
            <Tags />
            {showLabels ? "隐藏" : "显示"}
            {activeCity ? "区名" : areaLabelNoun(focusProvinceCode)}
          </Toggle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetToken((token) => token + 1)}
            aria-label="复位地图"
          >
            <RotateCcw data-icon="inline-start" />
            复位
          </Button>
        </div>
      </div>

      {pointsQuery.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>地图数据加载失败</AlertTitle>
          <AlertDescription>{pointsQuery.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="relative min-h-[560px] flex-1 overflow-hidden rounded-lg border bg-background">
        {area ? (
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <TicketMapChart
              points={visiblePoints}
              area={area}
              onPointClick={onPointClick}
              onAreaDoubleClick={onAreaDoubleClick}
              showLabels={showLabels}
              resetToken={resetToken}
              highlightCode={highlightCode}
            />
          </Suspense>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
        {regionData && (
          <RegionRanking
            ranking={ranking}
            level={rankLevel}
            levels={rankLevels}
            onLevelChange={setPreferredRankLevel}
            onRowSelect={(path) => void onRegionSelect(path)}
            onOpenTickets={onPointClick}
            highlightCodes={searchValue}
            search={
              <RegionSearch
                value={searchValue}
                onSelect={(path) => void onRegionSelect(path)}
                onClear={() => focusProvince(null)}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
