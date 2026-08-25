import type { AppRouter } from "@insuredesk/api";
import type { ReminderRule } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { SlaPolicyDialog } from "./SlaPolicyDialog";

/**
 * A save is the whole rollout: new tickets stamp dueAt from the saved hours
 * and the 待办 poll judges by the saved rules, while existing tickets keep
 * their dueAt. 停用不拆引用、不物理删除。
 */
export type SlaPolicyRow = inferRouterOutputs<AppRouter>["sla"]["list"][number];

function describeRule(rule: ReminderRule): string {
  return rule.type === "follow_up_checkpoint"
    ? `${rule.checkpointHours} 小时内累计跟进 ${rule.requiredCount} 次，提前 ${rule.advanceMinutes} 分钟提醒`
    : `距上次跟进每满 ${rule.intervalHours} 小时提醒，直至完结`;
}

function PolicyCard({
  policy,
  canEdit,
  isFirst,
  isLast,
  sortPending,
  onEdit,
  onMove,
  onDeactivate,
  onRevive,
}: {
  policy: SlaPolicyRow;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  sortPending: boolean;
  onEdit: () => void;
  onMove: (delta: -1 | 1) => void;
  onDeactivate: () => void;
  onRevive: () => void;
}) {
  return (
    <Card className={policy.active ? undefined : "opacity-60"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 leading-normal">
          {policy.name}
          {policy.active ? (
            <Badge variant="secondary">启用</Badge>
          ) : (
            <Badge variant="outline">已停用</Badge>
          )}
        </CardTitle>
        {canEdit && (
          <CardAction>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`上移 ${policy.name}`}
                disabled={isFirst || sortPending}
                onClick={() => onMove(-1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`下移 ${policy.name}`}
                disabled={isLast || sortPending}
                onClick={() => onMove(1)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`编辑 ${policy.name}`}
                onClick={onEdit}
              >
                编辑
              </Button>
              {policy.active ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`停用 ${policy.name}`}
                  className="text-destructive hover:text-destructive"
                  onClick={onDeactivate}
                >
                  停用
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`复活 ${policy.name}`}
                  onClick={onRevive}
                >
                  复活
                </Button>
              )}
            </div>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {policy.description && <p className="text-muted-foreground">{policy.description}</p>}
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: rules carry no id; position is their identity within a policy
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

function DeactivatePolicyDialog({
  policy,
  onOpenChange,
}: {
  policy: SlaPolicyRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const setActive = trpc.sla.setActive.useMutation({
    onSuccess: (saved) => {
      toast.success(`已停用「${saved.name}」，新建工单不可再选；存量工单不受影响`);
      utils.sla.list.invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={policy !== null}
      onOpenChange={(next) => {
        if (setActive.isPending) {
          return;
        }
        setActive.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>停用时效策略</DialogTitle>
          <DialogDescription>
            {`确定停用“${policy?.name ?? ""}”吗？停用后新建工单不可再选该策略，存量工单的处理时限与提醒不受影响；策略保留在目录中，可随时复活。`}
          </DialogDescription>
        </DialogHeader>
        {setActive.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>停用失败</AlertTitle>
            <AlertDescription>{setActive.error.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={setActive.isPending}>
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={setActive.isPending || !policy}
            onClick={() => policy && setActive.mutate({ id: policy.id, active: false })}
          >
            {setActive.isPending && <Spinner data-icon="inline-start" />}
            {setActive.isPending ? "停用中…" : "确认停用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SlaPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("sla.edit");

  const utils = trpc.useUtils();
  const listQuery = trpc.sla.list.useQuery();
  const [editor, setEditor] = useState<{ open: boolean; policy: SlaPolicyRow | null }>({
    open: false,
    policy: null,
  });
  const [deactivateTarget, setDeactivateTarget] = useState<SlaPolicyRow | null>(null);

  const sort = trpc.sla.sort.useMutation({
    // sla.sort 响应即重排后的完整目录。
    onSuccess: (rows) => utils.sla.list.setData(undefined, rows),
    onError: (error) => toast.error(error.message),
  });
  const revive = trpc.sla.setActive.useMutation({
    onSuccess: (saved) => {
      toast.success(`已复活「${saved.name}」`);
      utils.sla.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  // 服务端按种类 displayOrder + 组内 sortOrder 排序，这里按连续同组切段
  const groups: { kindId: string; kindName: string; policies: SlaPolicyRow[] }[] = [];
  for (const policy of listQuery.data ?? []) {
    const last = groups.at(-1);
    if (last && last.kindId === policy.kindId) {
      last.policies.push(policy);
    } else {
      groups.push({ kindId: policy.kindId, kindName: policy.kindName, policies: [policy] });
    }
  }

  function move(group: { kindId: string; policies: SlaPolicyRow[] }, index: number, delta: -1 | 1) {
    const neighbor = group.policies[index + delta];
    const current = group.policies[index];
    if (!neighbor || !current) {
      return;
    }
    const policyIds = group.policies.map((policy) => policy.id);
    policyIds[index] = neighbor.id;
    policyIds[index + delta] = current.id;
    sort.mutate({ kindId: group.kindId, policyIds });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">SLA 策略</h1>
        <p className="text-sm text-muted-foreground">
          时效策略按工单种类分组管理，各组独立排序与启停；建单与编辑工单的策略下拉只列该工单种类的策略。保存即时生效——此后新建单按所选策略计算处理时限、待办告警按新规则判定；存量工单不变。停用后新建工单不可再选，无物理删除。
        </p>
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>SLA 策略加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-6">
          {listQuery.isLoading && (
            <div className="grid gap-4 xl:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <Card key={index}>
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
            </div>
          )}
          {groups.map((group, groupIndex) => (
            <Fragment key={group.kindId}>
              {groupIndex > 0 && <Separator />}
              <section className="flex flex-col gap-3">
                <h2 className="text-base font-medium">{group.kindName}</h2>
                <div className="grid gap-4 xl:grid-cols-2">
                  {group.policies.map((policy, index) => (
                    <PolicyCard
                      key={policy.id}
                      policy={policy}
                      canEdit={canEdit}
                      isFirst={index === 0}
                      isLast={index === group.policies.length - 1}
                      sortPending={sort.isPending}
                      onEdit={() => setEditor({ open: true, policy })}
                      onMove={(delta) => move(group, index, delta)}
                      onDeactivate={() => setDeactivateTarget(policy)}
                      onRevive={() => revive.mutate({ id: policy.id, active: true })}
                    />
                  ))}
                </div>
              </section>
            </Fragment>
          ))}
          {canEdit && !listQuery.isLoading && (
            <button
              type="button"
              onClick={() => setEditor({ open: true, policy: null })}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="size-5" />
              新增策略
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <>
          <SlaPolicyDialog
            open={editor.open}
            policy={editor.policy}
            onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
          />
          <DeactivatePolicyDialog
            policy={deactivateTarget}
            onOpenChange={(open) => {
              if (!open) setDeactivateTarget(null);
            }}
          />
        </>
      )}
    </div>
  );
}
