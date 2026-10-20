import { MapChart, ScatterChart } from "echarts/charts";
import { GeoComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { ChinaProvincesGeoJson } from "@/lib/region";
import type { MapPoint } from "./map-points";

echarts.use([MapChart, ScatterChart, GeoComponent, TooltipComponent, CanvasRenderer]);

const POINT_COLOR = "#e03131";

type GeoJsonInput = Parameters<typeof echarts.registerMap>[1];

export interface MapArea {
  /** 全国视图为 null；单省/单市视图为省码/市码，底图只含其下一级边界。 */
  readonly areaCode: string | null;
  readonly geoJson: ChinaProvincesGeoJson;
  readonly counts: ReadonlyMap<string, number>;
}

const registered = new Set<string>();

function ensureMap(area: MapArea): string {
  const name = `insuredesk-${area.areaCode ?? "china"}`;
  if (!registered.has(name)) {
    echarts.registerMap(name, area.geoJson as unknown as GeoJsonInput);
    registered.add(name);
  }
  return name;
}

function isRegionFeature(feature: ChinaProvincesGeoJson["features"][number]) {
  return /^\d{6}$/.test(String(feature.properties.adcode));
}

interface ScatterDatum {
  value: MapPoint["value"];
  code: string;
  label: string;
  count: number;
}

const AREA_LABEL = { show: true, fontSize: 11, color: "#6b7280" };

const HIGHLIGHT_STYLE = { areaColor: "#fff4e6", borderColor: "#f08c00", borderWidth: 2 };

/** 全国视图省名用简称且不标港澳：全称与港澳名在京津冀、粤港澳一带挤成一团。 */
const NATIONAL_UNLABELED = new Set(["香港特别行政区", "澳门特别行政区"]);

function nationalLabel(name: string): string {
  if (NATIONAL_UNLABELED.has(name)) return "";
  return name.replace(/(维吾尔|壮族|回族)?(自治区|特别行政区|省|市)$/, "");
}

function buildOption(
  points: readonly MapPoint[],
  area: MapArea,
  clickable: boolean,
  showLabels: boolean,
  highlightCode: string | null,
) {
  const highlightName = highlightCode
    ? area.geoJson.features.find((feature) => String(feature.properties.adcode) === highlightCode)
        ?.properties.name
    : undefined;

  const areaData = area.geoJson.features.filter(isRegionFeature).map((feature) => ({
    name: feature.properties.name,
    value: area.counts.get(String(feature.properties.adcode)) ?? 0,
  }));

  return {
    animation: false,
    tooltip: { trigger: "item" as const, confine: true },
    geo: {
      map: ensureMap(area),
      roam: true,
      ...(area.areaCode === null
        ? { zoom: 1.2, center: [104.5, 36] as [number, number] }
        : { layoutCenter: ["50%", "50%"], layoutSize: "92%" }),
      scaleLimit: { min: 1, max: 80 },
      label: showLabels
        ? {
            ...AREA_LABEL,
            ...(area.areaCode === null && {
              formatter: (params: { name: string }) => nationalLabel(params.name),
            }),
          }
        : { show: false },
      itemStyle: { areaColor: "#ffffff", borderColor: "#b8bec7", borderWidth: 0.8 },
      emphasis: {
        label: showLabels ? { ...AREA_LABEL, color: "#343a40" } : { show: false },
        itemStyle: { areaColor: "#f1f3f5", borderColor: "#868e96" },
      },
      select: { disabled: true },
      regions: highlightName
        ? [
            {
              name: highlightName,
              itemStyle: HIGHLIGHT_STYLE,
              label: { ...AREA_LABEL, color: "#d9480f", fontWeight: "bold" as const },
            },
          ]
        : [],
    },
    series: [
      {
        type: "map" as const,
        geoIndex: 0,
        data: areaData,
        tooltip: {
          formatter: (params: { name: string; value: number }) =>
            params.name ? `${params.name}：${Number(params.value) || 0} 例` : "",
        },
      },
      {
        type: "scatter" as const,
        coordinateSystem: "geo" as const,
        geoIndex: 0,
        symbolSize: 6,
        cursor: clickable ? "pointer" : "default",
        itemStyle: { color: POINT_COLOR, opacity: 0.85 },
        emphasis: { scale: 1.6, itemStyle: { opacity: 1 } },
        data: points.map(
          (point): ScatterDatum => ({
            value: point.value,
            code: point.code,
            label: point.label,
            count: point.count,
          }),
        ),
        tooltip: {
          formatter: (params: { data: ScatterDatum }) =>
            `${params.data.label}：${params.data.count} 例`,
        },
        zlevel: 1,
      },
    ],
  };
}

export function TicketMapChart({
  points,
  area,
  onPointClick,
  onAreaDoubleClick,
  showLabels,
  resetToken,
  highlightCode = null,
}: {
  points: readonly MapPoint[];
  area: MapArea;
  onPointClick?: (code: string) => void;
  onAreaDoubleClick?: (code: string) => void;
  showLabels: boolean;
  resetToken: number;
  highlightCode?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;
  const dblClickRef = useRef(onAreaDoubleClick);
  dblClickRef.current = onAreaDoubleClick;
  const areaRef = useRef(area);
  areaRef.current = area;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;
    chart.on("click", (params) => {
      if (params.seriesType !== "scatter") return;
      clickRef.current?.((params.data as unknown as ScatterDatum).code);
    });
    chart.on("dblclick", (params) => {
      if (params.seriesType !== "map") return;
      const feature = areaRef.current.geoJson.features.find(
        (candidate) => isRegionFeature(candidate) && candidate.properties.name === params.name,
      );
      if (feature) dblClickRef.current?.(String(feature.properties.adcode));
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetToken 仅作触发器
  useEffect(() => {
    chartRef.current?.setOption(
      buildOption(points, area, onPointClick !== undefined, showLabels, highlightCode),
      {
        notMerge: true,
      },
    );
  }, [points, area, onPointClick !== undefined, showLabels, highlightCode, resetToken]);

  return <div ref={containerRef} className="h-full min-h-[560px] w-full" />;
}
