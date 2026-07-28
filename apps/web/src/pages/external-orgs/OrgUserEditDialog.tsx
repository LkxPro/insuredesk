import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ExternalOrgUserUpdateInput,
  externalOrgUserUpdateInputSchema,
} from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { OrgUserRow } from "./ExternalOrgDetailPage";

/**
 * 编辑机构账号 (external_org.manage): basic info + optional password reset +
 * 所属机构 migration. 停用机构不作为新迁入目标，已绑定者可保持原值。
 */
export function OrgUserEditDialog({
  user,
  orgId,
  onOpenChange,
}: {
  user: OrgUserRow | null;
  /** The detail page's org — the account's current binding. */
  orgId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const open = user !== null;

  const form = useForm<ExternalOrgUserUpdateInput>({
    resolver: zodResolver(externalOrgUserUpdateInputSchema),
    defaultValues: {
      id: "",
      username: "",
      name: "",
      email: "",
      password: "",
      externalOrgId: "",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email ?? "",
        password: "",
        externalOrgId: orgId,
      });
    }
  }, [user, orgId, form]);

  const orgOptions = trpc.externalOrg.list.useQuery(undefined, { enabled: open });

  const update = trpc.externalOrg.updateUser.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新账号 ${result.name}`);
      utils.externalOrg.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => update.mutate(values));
  const busy = update.isPending;
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑账号</DialogTitle>
          <DialogDescription>修改用户名后该账号下次登录需用新用户名。</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="org-user-edit-name">姓名</FieldLabel>
              <Input id="org-user-edit-name" {...form.register("name")} />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="org-user-edit-username">用户名</FieldLabel>
              <Input
                id="org-user-edit-username"
                {...form.register("username")}
                placeholder="登录账号"
              />
              {errors.username && <FieldError>{errors.username.message}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="org-user-edit-email">邮箱（可选）</FieldLabel>
            <Input id="org-user-edit-email" {...form.register("email")} />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="org-user-edit-password">重置密码</FieldLabel>
            <Input
              id="org-user-edit-password"
              type="password"
              {...form.register("password")}
              placeholder="留空则不修改"
            />
            <FieldDescription>填写后该账号在线会话即刻失效，需用新密码登录。</FieldDescription>
            {errors.password && <FieldError>{errors.password.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.externalOrgId}>
            <FieldLabel htmlFor="org-user-edit-org">所属外部机构</FieldLabel>
            <Controller
              control={form.control}
              name="externalOrgId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="org-user-edit-org"
                    className="w-full"
                    disabled={orgOptions.isLoading}
                  >
                    <SelectValue placeholder="请选择外部机构" />
                  </SelectTrigger>
                  <SelectContent>
                    {(orgOptions.data ?? [])
                      .filter((org) => org.active || org.id === field.value)
                      .map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                          {!org.active && "（已停用）"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldDescription>可迁移到其他启用机构；停用机构不可作为新迁入目标。</FieldDescription>
            {errors.externalOrgId && <FieldError>{errors.externalOrgId.message}</FieldError>}
          </Field>

          {update.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>保存失败</AlertTitle>
              <AlertDescription>{update.error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
