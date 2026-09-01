import type { ApiKeyListItem } from "@insuredesk/shared";
import { AlertCircle, Plus } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { CreateApiKeyDialog } from "./CreateApiKeyDialog";

const DOC_LINKS = [
  { label: "OpenAPI 规格", href: "/api/v1/openapi.json" },
  { label: "数据分析接入文档", href: "/docs/analytics" },
  { label: "接口元信息", href: "/api/v1/meta" },
] as const;

export function ApiKeysCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("api_key.manage");

  const utils = trpc.useUtils();
  const listQuery = trpc.apiKey.list.useQuery(undefined, { enabled: canManage });

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyListItem | null>(null);

  const revoke = trpc.apiKey.revoke.useMutation({
    onSuccess: () => {
      toast.success("API key 已吊销");
      utils.apiKey.list.invalidate();
      setRevokeTarget(null);
    },
  });

  if (!canManage) {
    return null;
  }

  const keys = listQuery.data ?? [];

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>API key</CardTitle>
        <CardDescription>
          供脚本与外部系统以你的身份调用开放 API。明文仅创建成功时展示一次。
        </CardDescription>
        <div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新建 API key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {listQuery.error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>API key 列表加载失败</AlertTitle>
            <AlertDescription>{listQuery.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>前缀</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>最近使用</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading &&
                  [1, 2].map((row) => (
                    <TableRow key={row}>
                      {[1, 2, 3, 4, 5, 6].map((cell) => (
                        <TableCell key={cell}>
                          <Skeleton className="h-5 w-full max-w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!listQuery.isLoading && keys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无 API key
                    </TableCell>
                  </TableRow>
                )}
                {keys.map((key) => (
                  <TableRow
                    key={key.id}
                    className={key.status === "revoked" ? "opacity-60" : undefined}
                  >
                    <TableCell className="font-medium">
                      {key.name}
                      {key.status === "revoked" && (
                        <Badge variant="destructive" className="ml-2">
                          已吊销
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">sk_live_…</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(key.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(key.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(key.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.status === "active" && (
                        <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(key)}>
                          吊销
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">接入文档</span>
          {DOC_LINKS.map(({ label, href }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {label}
            </a>
          ))}
        </div>
      </CardContent>

      <CreateApiKeyDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next && !revoke.isPending) setRevokeTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>吊销 API key</DialogTitle>
            <DialogDescription>
              {revokeTarget &&
                `确定吊销「${revokeTarget.name}」吗？吊销后立即失效、不可恢复，使用该 key 的集成将中断。`}
            </DialogDescription>
          </DialogHeader>

          {revoke.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>吊销失败</AlertTitle>
              <AlertDescription>{revoke.error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={revoke.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revokeTarget && revoke.mutate({ id: revokeTarget.id })}
            >
              {revoke.isPending && <Spinner data-icon="inline-start" />}
              {revoke.isPending ? "吊销中…" : "确认吊销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
