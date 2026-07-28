import type { AppRouter } from "@insuredesk/api";
import { DEFAULT_EXTERNAL_VISIBLE_FIELDS } from "@insuredesk/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertCircle, ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDateTime } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { ExternalOrgEditDialog, FIELD_LABELS } from "./ExternalOrgEditDialog";
import { OrgUserCreateDialog } from "./OrgUserCreateDialog";
import { OrgUserDisableDialog } from "./OrgUserDisableDialog";
import { OrgUserEditDialog } from "./OrgUserEditDialog";

export type OrgUserRow = inferRouterOutputs<AppRouter>["externalOrg"]["listUsers"][number];

/**
 * 机构详情：头部是机构信息与操作（编辑/停用），可见字段整块展开——列表页
 * 只给数量，配置核对要看到具体字段名单，这里是唯一整屏呈现白名单的地方。
 * 账号表承载该机构外部账号的完整生命周期，全部操作与本页同由
 * external_org.manage 单点执法，无需任何 user.* 权限点。
 */
export function ExternalOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const detailQuery = trpc.externalOrg.get.useQuery({ id: id ?? "" }, { enabled: !!id });
  const usersQuery = trpc.externalOrg.listUsers.useQuery({ orgId: id ?? "" }, { enabled: !!id });

  const [editing, setEditing] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState<OrgUserRow | null>(null);
  const [disableTarget, setDisableTarget] = useState<OrgUserRow | null>(null);

  const setActive = trpc.externalOrg.setActive.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(variables.active ? "已启用机构" : "已停用机构");
      utils.externalOrg.invalidate();
    },
    onError: (error) => toast.error(`操作失败：${error.message}`),
  });

  const enableUser = trpc.externalOrg.setUserActive.useMutation({
    onSuccess: (result) => {
      toast.success(`已启用账号 ${result.name}`);
      utils.externalOrg.invalidate();
    },
    onError: (error) => toast.error(`启用失败：${error.message}`),
  });

  const org = detailQuery.data;
  const fields = org ? (org.visibleTicketFields ?? [...DEFAULT_EXTERNAL_VISIBLE_FIELDS]) : [];
  const orgUsers = usersQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/external-orgs">
            <ArrowLeft data-icon="inline-start" />
            返回列表
          </Link>
        </Button>
        {org && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            {org.active ? (
              <Badge variant="outline">启用</Badge>
            ) : (
              <Badge variant="destructive">已停用</Badge>
            )}
            <div className="ml-auto flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                编辑
              </Button>
              {org.active ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={setActive.isPending}
                  onClick={() => setActive.mutate({ id: org.id, active: false })}
                >
                  停用
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setActive.isPending}
                  onClick={() => setActive.mutate({ id: org.id, active: true })}
                >
                  启用
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {detailQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>机构加载失败</AlertTitle>
          <AlertDescription>{detailQuery.error.message}</AlertDescription>
        </Alert>
      ) : !org ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">机构信息</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">关联渠道</dt>
                  <dd className="m-0 text-sm">{org.channelName ?? "—"}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">账号数</dt>
                  <dd className="m-0 text-sm">{org.userCount}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                可见字段（{fields.length} 个{org.visibleTicketFields === null ? "，系统默认" : ""}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {fields.map((key) => (
                  <Badge key={key} variant="secondary">
                    {FIELD_LABELS[key] ?? key}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">机构账号</CardTitle>
              <Button size="sm" onClick={() => setCreateUserOpen(true)}>
                <Plus data-icon="inline-start" />
                新建账号
              </Button>
            </CardHeader>
            <CardContent>
              {usersQuery.error ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>账号列表加载失败</AlertTitle>
                  <AlertDescription>{usersQuery.error.message}</AlertDescription>
                </Alert>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>姓名</TableHead>
                        <TableHead>用户名</TableHead>
                        <TableHead>邮箱</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersQuery.isLoading &&
                        [1, 2].map((row) => (
                          <TableRow key={row}>
                            {[1, 2, 3, 4, 5, 6].map((cell) => (
                              <TableCell key={cell}>
                                <Skeleton className="h-5 w-full max-w-24" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      {!usersQuery.isLoading && orgUsers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                            暂无账号
                          </TableCell>
                        </TableRow>
                      )}
                      {orgUsers.map((user) => (
                        <TableRow key={user.id} className={user.active ? undefined : "opacity-60"}>
                          <TableCell className="font-medium">{user.name}</TableCell>
                          <TableCell className="text-muted-foreground">{user.username}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.email ?? "—"}
                          </TableCell>
                          <TableCell>
                            {user.active ? (
                              <Badge variant="outline">启用</Badge>
                            ) : (
                              <Badge variant="destructive">已禁用</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(user.createdAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditUserTarget(user)}
                              >
                                编辑
                              </Button>
                              {/* 自禁用会当场锁死操作者，服务端同样拒绝 */}
                              {user.id !== me?.id &&
                                (user.active ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setDisableTarget(user)}
                                  >
                                    禁用
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={enableUser.isPending}
                                    onClick={() => enableUser.mutate({ id: user.id, active: true })}
                                  >
                                    启用
                                  </Button>
                                ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {org && (
        <>
          <ExternalOrgEditDialog
            org={editing ? org : null}
            onOpenChange={(open) => {
              if (!open) setEditing(false);
            }}
          />
          <OrgUserCreateDialog org={org} open={createUserOpen} onOpenChange={setCreateUserOpen} />
          <OrgUserEditDialog
            user={editUserTarget}
            orgId={org.id}
            onOpenChange={(open) => {
              if (!open) setEditUserTarget(null);
            }}
          />
          <OrgUserDisableDialog
            user={disableTarget}
            onOpenChange={(open) => {
              if (!open) setDisableTarget(null);
            }}
          />
        </>
      )}
    </div>
  );
}
