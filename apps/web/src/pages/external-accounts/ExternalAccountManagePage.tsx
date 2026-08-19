import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ExternalAccountDisableDialog } from "./ExternalAccountDisableDialog";
import { ExternalAccountEditDialog } from "./ExternalAccountEditDialog";

export type ExternalAccountRow = inferRouterOutputs<AppRouter>["externalAccount"]["list"][number];

/** 预填概览：已配置值按序拼接；空 = 未配置。 */
export function prefillSummary(prefill: ExternalAccountRow["prefill"]): string {
  return [
    prefill.channelName,
    prefill.project,
    prefill.brokerageEntity,
    prefill.paymentChannel,
    prefill.userComplaintChannelName,
    prefill.complaintReceiveChannelName,
  ]
    .filter((value) => value)
    .join(" · ");
}

/**
 * 外部账号管理 (external_account.manage 单点)：列表即全部——没有详情页，
 * 编辑弹窗直接吃列表行。账号的提交/留言/导出能力恒为一档，管理界面不出现"角色"。
 */
export function ExternalAccountManagePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("external_account.manage");

  const utils = trpc.useUtils();
  const listQuery = trpc.externalAccount.list.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExternalAccountRow | null>(null);
  const [disableTarget, setDisableTarget] = useState<ExternalAccountRow | null>(null);

  const setActive = trpc.externalAccount.setActive.useMutation({
    onSuccess: (result) => {
      toast.success(`已启用账号 ${result.name}`);
      utils.externalAccount.invalidate();
    },
    onError: (error) => toast.error(`操作失败：${error.message}`),
  });

  const accounts = listQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">外部账号管理</h1>
          <p className="text-sm text-muted-foreground">
            创建、编辑、启停外部账号，为每个账号配置提交预填。
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新建账号
          </Button>
        )}
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>账号列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>预填</TableHead>
                <TableHead>提交工单数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading &&
                [1, 2, 3].map((row) => (
                  <TableRow key={row}>
                    {[1, 2, 3, 4, 5, 6].map((cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full max-w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!listQuery.isLoading && accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    暂无外部账号
                  </TableCell>
                </TableRow>
              )}
              {accounts.map((account) => {
                const summary = prefillSummary(account.prefill);
                return (
                  <TableRow key={account.id} className={cn(!account.active && "opacity-60")}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-muted-foreground" />
                        {account.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{account.username}</TableCell>
                    <TableCell
                      className="max-w-48 truncate text-muted-foreground"
                      title={summary || undefined}
                    >
                      {summary || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{account.ticketCount}</TableCell>
                    <TableCell>
                      {account.active ? (
                        <Badge variant="outline">启用</Badge>
                      ) : (
                        <Badge variant="destructive">已禁用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canManage && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditTarget(account)}
                            >
                              编辑
                            </Button>
                            {account.active ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDisableTarget(account)}
                              >
                                禁用
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={setActive.isPending}
                                onClick={() => setActive.mutate({ id: account.id, active: true })}
                              >
                                启用
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && <ExternalAccountEditDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {canManage && (
        <ExternalAccountEditDialog
          account={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
      {canManage && (
        <ExternalAccountDisableDialog
          account={disableTarget}
          onOpenChange={(open) => {
            if (!open) setDisableTarget(null);
          }}
        />
      )}
    </div>
  );
}
