import { zodResolver } from "@hookform/resolvers/zod";
import { type UserUpdateInput, userUpdateInputSchema } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import type { UserRow } from "./UsersPage";

/**
 * 编辑用户 (user.edit): basic info + optional password reset. username is
 * immutable (it's the login handle) and the role is deliberately absent —
 * changing it is 分配角色, a separate permission point (user.assign_role).
 */
export function UserEditDialog({
  user,
  onOpenChange,
}: {
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const open = user !== null;

  const form = useForm<UserUpdateInput>({
    resolver: zodResolver(userUpdateInputSchema),
    defaultValues: { id: "", name: "", email: "", team: "", password: "" },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        id: user.id,
        name: user.name,
        email: user.email ?? "",
        team: user.team ?? "",
        password: "",
      });
    }
  }, [user, form]);

  const update = trpc.user.update.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新用户 ${result.name}`);
      utils.user.list.invalidate();
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
          <DialogTitle>编辑用户</DialogTitle>
          <DialogDescription>
            {user && `用户名 ${user.username} 不可修改；角色请通过「分配角色」调整。`}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="edit-name">姓名</FieldLabel>
            <Input id="edit-name" {...form.register("name")} />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="edit-email">邮箱（可选）</FieldLabel>
              <Input id="edit-email" {...form.register("email")} />
              {errors.email && <FieldError>{errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.team}>
              <FieldLabel htmlFor="edit-team">团队（可选）</FieldLabel>
              <Input id="edit-team" {...form.register("team")} />
              {errors.team && <FieldError>{errors.team.message}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="edit-password">重置密码</FieldLabel>
            <Input
              id="edit-password"
              type="password"
              {...form.register("password")}
              placeholder="留空则不修改"
            />
            <FieldDescription>填写后该用户需用新密码登录。</FieldDescription>
            {errors.password && <FieldError>{errors.password.message}</FieldError>}
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
