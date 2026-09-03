import { keepPreviousData } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { presetToCreatedRange } from "@/lib/created-range";
import { trpc } from "@/lib/trpc";
import { CreatedRangeFilter } from "@/pages/ticket-surface/CreatedRangeFilter";
import {
  ActionSection,
  ActionSectionSkeleton,
  PolicySection,
  PolicySectionSkeleton,
} from "./action-section";
import { AgentSection, AgentSectionSkeleton } from "./agent-section";
import { MatrixSection, MatrixSectionSkeleton } from "./cross-matrix";
import { DistributionSection, DistributionSectionSkeleton } from "./distribution-section";
import { TrendSection, TrendSectionSkeleton } from "./trend-section";
import { useCreatedRangeQueryParams } from "./useCreatedRangeQueryParams";

function LoadError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>看板数据加载失败</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function DashboardPage() {
  const [createdRange, setCreatedRange] = useCreatedRangeQueryParams();
  const hasRange = createdRange.createdFrom !== undefined || createdRange.createdTo !== undefined;
  // URL 无参时按「近 30 天」预设；memo 钉住 now——每次渲染重算会生成新 ISO，
  // query key 跟着变导致无限重查。
  const defaultRange = useMemo(() => presetToCreatedRange("last30Days"), []);
  const effectiveRange = hasRange ? createdRange : defaultRange;

  const actionQuery = trpc.dashboard.actionStats.useQuery(undefined, { refetchInterval: 30_000 });
  const analysisQuery = trpc.dashboard.analysisStats.useQuery(effectiveRange, {
    placeholderData: keepPreviousData,
  });
  const analysis = analysisQuery.data;
  const scope = analysis?.scope ?? actionQuery.data?.scope;

  return (
    <div className="flex flex-1 flex-col gap-6 pb-24">
      <div className="fixed right-4 top-16 z-40 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 shadow-sm backdrop-blur md:right-6">
        <span className="text-xs text-muted-foreground">统计周期</span>
        <CreatedRangeFilter range={effectiveRange} onChange={setCreatedRange} />
        {scope === "own" && <Badge variant="secondary">仅统计我名下的工单</Badge>}
      </div>

      {actionQuery.error ? (
        <LoadError message={actionQuery.error.message} />
      ) : actionQuery.data ? (
        <>
          <ActionSection stats={actionQuery.data} />
          <PolicySection policies={actionQuery.data.policies} />
        </>
      ) : (
        <>
          <ActionSectionSkeleton />
          <PolicySectionSkeleton />
        </>
      )}

      {analysisQuery.error ? (
        <LoadError message={analysisQuery.error.message} />
      ) : analysis ? (
        <>
          <MatrixSection matrix={analysis.matrix} />
          <TrendSection trend={analysis.trend} />
          <DistributionSection
            kinds={analysis.kinds}
            categories={analysis.categories}
            sources={analysis.sources}
          />
          <AgentSection agents={analysis.agents} />
        </>
      ) : (
        <>
          <MatrixSectionSkeleton />
          <TrendSectionSkeleton />
          <DistributionSectionSkeleton />
          <AgentSectionSkeleton />
        </>
      )}
    </div>
  );
}
