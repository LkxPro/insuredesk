import type { AppRouter } from "@insuredesk/api";
import { DEFAULT_EXTERNAL_VISIBLE_FIELDS } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, Building2, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
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
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ExternalOrgEditDialog } from "./ExternalOrgEditDialog";

export type ExternalOrgRow = inferRouterOutputs<AppRouter>["externalOrg"]["list"][number];

export function visibleFieldCount(visibleTicketFields: string[] | null): number {
  return visibleTicketFields?.length ?? DEFAULT_EXTERNAL_VISIBLE_FIELDS.length;
}

export function ExternalOrgManagePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("external_org.manage");
  const navigate = useNavigate();

  const utils = trpc.useUtils();
  const listQuery = trpc.externalOrg.list.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExternalOrgRow | null>(null);

  const setActive = trpc.externalOrg.setActive.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(variables.active ? "已启用机构" : "已停用机构");
      utils.externalOrg.invalidate();
    },
    onError: (error) => toast.error(`操作失败：${error.message}`),
  });

  const orgs = listQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">外部机构管理</h1>
          <p className="text-sm text-muted-foreground">
            创建、编辑、停用外部机构，为每个机构配置关联渠道和可见字段白名单。
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新建机构
          </Button>
        )}
      </div>

      {listQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>机构列表加载失败</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>机构名称</TableHead>
                <TableHead>关联渠道</TableHead>
                <TableHead>可见字段数</TableHead>
                <TableHead>账号数</TableHead>
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
              {!listQuery.isLoading && orgs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    暂无机构
                  </TableCell>
                </TableRow>
              )}
              {orgs.map((org) => (
                <TableRow
                  key={org.id}
                  className={cn("cursor-pointer", !org.active && "opacity-60")}
                  onClick={() => navigate(`/external-orgs/${org.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {/* 行点击是鼠标的便利路径；机构名上的链接是键盘与
                          读屏的正路（与 工单管理 同一处理） */}
                      <Link
                        to={`/external-orgs/${org.id}`}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {org.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{org.channelName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {visibleFieldCount(org.visibleTicketFields)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Link
                      to={`/external-orgs/${org.id}`}
                      className="hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {org.userCount}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {org.active ? (
                      <Badge variant="outline">启用</Badge>
                    ) : (
                      <Badge variant="destructive">已停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {canManage && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditTarget(org)}>
                            编辑
                          </Button>
                          {org.active ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={setActive.isPending}
                              onClick={() => setActive.mutate({ id: org.id, active: false })}
                            >
                              停用
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={setActive.isPending}
                              onClick={() => setActive.mutate({ id: org.id, active: true })}
                            >
                              启用
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && <ExternalOrgEditDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {canManage && (
        <ExternalOrgEditDialog
          org={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
