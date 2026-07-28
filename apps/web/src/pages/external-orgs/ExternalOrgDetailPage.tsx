import { DEFAULT_EXTERNAL_VISIBLE_FIELDS } from "@insuredesk/shared";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ExternalOrgEditDialog, FIELD_LABELS } from "./ExternalOrgEditDialog";

/**
 * 机构详情：头部是机构信息与操作（编辑/停用），可见字段整块展开——列表页
 * 只给数量，配置核对要看到具体字段名单，这里是唯一整屏呈现白名单的地方。
 */
export function ExternalOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();
  const detailQuery = trpc.externalOrg.get.useQuery({ id: id ?? "" }, { enabled: !!id });

  const [editing, setEditing] = useState(false);

  const setActive = trpc.externalOrg.setActive.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(variables.active ? "已启用机构" : "已停用机构");
      utils.externalOrg.invalidate();
    },
    onError: (error) => toast.error(`操作失败：${error.message}`),
  });

  const org = detailQuery.data;
  const fields = org ? (org.visibleTicketFields ?? [...DEFAULT_EXTERNAL_VISIBLE_FIELDS]) : [];

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
        </>
      )}

      {org && (
        <ExternalOrgEditDialog
          org={editing ? org : null}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
        />
      )}
    </div>
  );
}
