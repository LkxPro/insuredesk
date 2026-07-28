import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ExternalOrgUserCreateInput,
  externalOrgUserCreateInputSchema,
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

/**
 * 新建机构账号 (external_org.manage): 所属机构锁定为当前机构（只展示、不可选），
 * 角色下拉仅外部角色，表单不含团队字段。
 */
export function OrgUserCreateDialog({
  org,
  open,
  onOpenChange,
}: {
  org: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<ExternalOrgUserCreateInput>({
    resolver: zodResolver(externalOrgUserCreateInputSchema),
    defaultValues: {
      orgId: org.id,
      username: "",
      password: "",
      name: "",
      email: "",
      roleId: "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ orgId: org.id, username: "", password: "", name: "", email: "", roleId: "" });
    }
  }, [open, org.id, form]);

  const roleOptions = trpc.externalOrg.externalRoleOptions.useQuery(undefined, { enabled: open });

  const create = trpc.externalOrg.createUser.useMutation({
    onSuccess: (result) => {
      toast.success(`已创建账号 ${result.name}`);
      utils.externalOrg.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => create.mutate(values));
  const busy = create.isPending;
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建账号</DialogTitle>
          <DialogDescription>创建可登录的机构账号，仅能看到本机构提交的工单。</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field>
            <FieldLabel htmlFor="org-user-org">所属机构</FieldLabel>
            <Input id="org-user-org" value={org.name} disabled readOnly />
            <FieldDescription>新账号固定归属当前机构。</FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="org-user-name">姓名</FieldLabel>
              <Input id="org-user-name" {...form.register("name")} placeholder="如：张三" />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="org-user-username">用户名</FieldLabel>
              <Input id="org-user-username" {...form.register("username")} placeholder="登录账号" />
              {errors.username && <FieldError>{errors.username.message}</FieldError>}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="org-user-password">初始密码</FieldLabel>
              <Input id="org-user-password" type="password" {...form.register("password")} />
              {errors.password && <FieldError>{errors.password.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="org-user-email">邮箱（可选）</FieldLabel>
              <Input id="org-user-email" {...form.register("email")} />
              {errors.email && <FieldError>{errors.email.message}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!errors.roleId}>
            <FieldLabel htmlFor="org-user-role">角色</FieldLabel>
            <Controller
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="org-user-role"
                    className="w-full"
                    disabled={roleOptions.isLoading}
                  >
                    <SelectValue placeholder="请选择外部角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roleOptions.data ?? []).map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.roleId && <FieldError>{errors.roleId.message}</FieldError>}
          </Field>

          {create.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>创建失败</AlertTitle>
              <AlertDescription>{create.error.message}</AlertDescription>
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
              {busy ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
