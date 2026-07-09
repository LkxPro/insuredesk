import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@insuredesk/api";
import { COMPLAINT_LEVELS, type ReminderRule } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { SlaPolicyEditDialog } from "./SlaPolicyEditDialog";

/**
 * SLA 策略 (issue #33, PRD §3.8, ADR 0005): one card per complaint level —
 * 首响违约线 / 超时时长 (可空 = 不设超时) / typed reminder rules. sla.view
 * opens the page (route-guarded); the per-level 编辑 dialog appears only with
 * sla.edit, and the API re-checks regardless. A save is the whole rollout:
 * new tickets stamp dueAt from the new hours and the 待办 poll judges by the
 * new rules, while existing tickets keep their dueAt (re-stamped only on a
 * complaintLevel edit).
 */

export type SlaPolicyRow = inferRouterOutputs<AppRouter>["sla"]["list"][number];

/** One reminder rule as prose, matching the PRD §3.8 semantics. */
export function describeRule(rule: ReminderRule): string {
  return rule.type === "follow_up_checkpoint"
    ? `${rule.checkpointHours} 小时内累计跟进 ${rule.requiredCount} 次，提前 ${rule.advanceMinutes} 分钟提醒`
    : `距上次跟进每满 ${rule.intervalHours} 小时提醒，直至完结`;
}

function PolicyCard({
  policy,
  canEdit,
  onEdit,
}: {
  policy: SlaPolicyRow;
  canEdit: boolean;
  onEdit: (policy: SlaPolicyRow) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{policy.complaintLevel}</CardTitle>
        {canEdit && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => onEdit(policy)}>
              编辑
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">首响违约线</span>
          <span>{policy.firstResponseMinutes} 分钟内首次跟进，过线染红</span>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">超时时长</span>
          <span>
            {policy.overdueHours === null ? (
              <Badge variant="outline">不设超时</Badge>
            ) : (
              `${policy.overdueHours} 小时（处理时限 = 创建 + ${policy.overdueHours}h）`
            )}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground">提醒规则</span>
          {policy.reminderRules.length === 0 ? (
            <span className="text-muted-foreground">无——仅保留待首响与超时告警</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {policy.reminderRules.map((rule, index) => (
                <li
                  // Rules carry no id; position is their identity within a level
                  key={`${rule.type}-${index}`}
                  className="flex items-center gap-2"
                >
                  <Badge variant="secondary" className="shrink-0">
                    {rule.type === "follow_up_checkpoint" ? "检查点" : "滚动"}
                  </Badge>
                  <span>{describeRule(rule)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SlaPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("sla.edit");

  const listQuery = trpc.sla.list.useQuery();
  const [editTarget, setEditTarget] = useState<SlaPolicyRow | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">SLA 策略</h1>
        <p className="text-sm text-muted-foreground">
          按投诉等级配置首响违约线、超时时长与提醒规则；保存即时生效——此后新建单按新超时计算处理时限、待办告警按新规则判定，存量工单的处理时限不变。
        </p>
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>SLA 策略加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {listQuery.isLoading &&
            COMPLAINT_LEVELS.map((level) => (
              <Card key={level}>
                <CardHeader>
                  <Skeleton className="h-6 w-24" />
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-2/3" />
                </CardContent>
              </Card>
            ))}
          {(listQuery.data ?? []).map((policy) => (
            <PolicyCard
              key={policy.complaintLevel}
              policy={policy}
              canEdit={canEdit}
              onEdit={setEditTarget}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <SlaPolicyEditDialog
          policy={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
