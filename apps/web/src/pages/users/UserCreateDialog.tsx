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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { type UserCreateInput, userCreateInputSchema } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

/**
 * 新增用户 (user.create): account basics + initial password + role. The field
 * contract is the shared userCreateInputSchema — the exact schema the API
 * parses (ADR 0006).
 */
export function UserCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<UserCreateInput>({
    resolver: zodResolver(userCreateInputSchema),
    defaultValues: { username: "", password: "", name: "", email: "", team: "", roleId: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset();
    }
  }, [open, form]);

  const roleOptions = trpc.user.roleOptions.useQuery(undefined, { enabled: open });

  const create = trpc.user.create.useMutation({
    onSuccess: (result) => {
      toast.success(`已创建用户 ${result.name}`);
      utils.user.list.invalidate();
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
          <DialogTitle>新增用户</DialogTitle>
          <DialogDescription>创建可登录的账号并分配角色。</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="user-name">姓名</FieldLabel>
              <Input id="user-name" {...form.register("name")} placeholder="如：张三" />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="user-username">用户名</FieldLabel>
              <Input id="user-username" {...form.register("username")} placeholder="登录账号" />
              {errors.username && <FieldError>{errors.username.message}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="user-password">初始密码</FieldLabel>
            <Input id="user-password" type="password" {...form.register("password")} />
            {errors.password && <FieldError>{errors.password.message}</FieldError>}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="user-email">邮箱（可选）</FieldLabel>
              <Input id="user-email" {...form.register("email")} />
              {errors.email && <FieldError>{errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.team}>
              <FieldLabel htmlFor="user-team">团队（可选）</FieldLabel>
              <Input id="user-team" {...form.register("team")} placeholder="仅作组织标签" />
              {errors.team && <FieldError>{errors.team.message}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!errors.roleId}>
            <FieldLabel htmlFor="user-role">角色</FieldLabel>
            <Controller
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="user-role" className="w-full" disabled={roleOptions.isLoading}>
                    <SelectValue placeholder="请选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roleOptions.data ?? []).map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                        {role.preset && "（预设）"}
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
