import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDurationMs } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  buildFirstResponseTicketListUrl,
  buildPolicyTicketListUrl,
  buildStatusTicketListUrl,
} from "./build-ticket-list-url";
import type { DashboardActionStats } from "./dashboard-types";
import { SectionHeader } from "./section-header";

const HOUR_MS = 60 * 60 * 1000;

const ACTION_NOTE =
  "已超时/即将超时含未分配单（未分配也在计时）；待首响仅计已分配。卡间有交集，勿加总。";

interface ActionCardSpec {
  key: string;
  label: string;
  value: number;
  tone: string;
  href: string;
  sub?: string;
  subDanger?: boolean;
}

function actionCardSpecs(metrics: DashboardActionStats["metrics"]): ActionCardSpec[] {
  return [
    {
      key: "overdue",
      label: "已超时",
      value: metrics.overdue,
      tone: "text-destructive",
      href: buildStatusTicketListUrl("overdue"),
      sub: "在途已过处理时限",
    },
    {
      key: "dueSoon",
      label: "即将超时",
      value: metrics.dueSoon,
      tone: "text-amber-600 dark:text-amber-500",
      href: buildStatusTicketListUrl("pending_timeout"),
      sub: "距时限不足 2 小时",
    },
    {
      key: "firstResponse",
      label: "待首响",
      value: metrics.awaitingFirstResponse,
      tone: "text-amber-600 dark:text-amber-500",
      href: buildFirstResponseTicketListUrl(),
      sub:
        metrics.firstResponseOverLine > 0
          ? `${metrics.firstResponseOverLine} 单已过首响线`
          : undefined,
      subDanger: true,
    },
    {
      key: "unassigned",
      label: "未分配",
      value: metrics.unassigned,
      tone: "text-sky-600 dark:text-sky-500",
      href: buildStatusTicketListUrl("unassigned"),
      sub:
        metrics.unassignedOldestWaitMs === null
          ? undefined
          : `最老已等待 ${formatDurationMs(metrics.unassignedOldestWaitMs)}`,
    },
  ];
}

export function ActionSection({ stats }: { stats: DashboardActionStats }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actionCardSpecs(stats.metrics).map((card) => {
          const hot = card.value > 0;
          return (
            <Link key={card.key} to={card.href} className="block">
              <Card className="h-full gap-2 py-4 transition-colors hover:bg-accent">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                  <div
                    className={cn(
                      "text-3xl font-semibold tabular-nums",
                      hot ? card.tone : "text-muted-foreground/50",
                    )}
                  >
                    {card.value}
                  </div>
                  {card.sub && (
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        card.subDanger && hot ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {card.sub}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{ACTION_NOTE}</p>
    </section>
  );
}

export function ActionSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="需要行动" note="实时 · 30 秒自动刷新" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <Card key={card} className="gap-2 py-4">
            <CardHeader className="px-4">
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent className="px-4">
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function PolicyCard({ policy }: { policy: DashboardActionStats["policies"][number] }) {
  return (
    <Card className="relative gap-1 py-3 transition-colors hover:bg-accent">
      <Link
        to={buildPolicyTicketListUrl(policy.policyId)}
        aria-label={policy.name}
        className="absolute inset-0 rounded-xl"
      />
      <CardContent className="flex flex-col gap-1 px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{policy.name}</span>
          <span className="shrink-0 rounded-full border px-1.5 text-[10px] whitespace-nowrap text-muted-foreground">
            {policy.timeoutMs === null ? "不设时限" : `${policy.timeoutMs / HOUR_MS}h`}
          </span>
        </div>
        {policy.kindName && (
          <span className="text-xs text-muted-foreground">{policy.kindName}</span>
        )}
        <div className="text-2xl font-semibold tabular-nums">
          {policy.inFlight}
          <span className="ml-1 text-xs font-normal text-muted-foreground">在途</span>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <Link
            to={buildPolicyTicketListUrl(policy.policyId, "overdue")}
            className={cn(
              "relative hover:underline",
              policy.overdue > 0 ? "text-destructive" : "text-muted-foreground/50",
            )}
          >
            超时 {policy.overdue}
          </Link>
          <Link
            to={buildPolicyTicketListUrl(policy.policyId, "pending_timeout")}
            className={cn(
              "relative hover:underline",
              policy.dueSoon > 0
                ? "text-amber-600 dark:text-amber-500"
                : "text-muted-foreground/50",
            )}
          >
            预警 {policy.dueSoon}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function PolicySection({ policies }: { policies: DashboardActionStats["policies"] }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {policies.map((policy) => (
          <PolicyCard key={policy.policyId ?? "none"} policy={policy} />
        ))}
      </div>
    </section>
  );
}

export function PolicySectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="时效策略" note="各策略在途与超时 · 实时" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <Card key={card} className="gap-1 py-3">
            <CardContent className="flex flex-col gap-2 px-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
