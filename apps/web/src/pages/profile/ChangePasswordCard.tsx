import { zodResolver } from "@hookform/resolvers/zod";
import { type ChangeOwnPasswordInput, changeOwnPasswordInputSchema } from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

/**
 * 修改密码 self-service block. Hidden entirely for roles holding the
 * restrictive point (勾选=禁止, the API rejects those requests too).
 */
export function ChangePasswordCard() {
  const { hasPermission } = useAuth();

  const form = useForm<ChangeOwnPasswordInput>({
    resolver: zodResolver(changeOwnPasswordInputSchema),
    defaultValues: { oldPassword: "", newPassword: "" },
  });

  const change = trpc.auth.changeOwnPassword.useMutation({
    onSuccess: () => {
      toast.success("密码已修改，其他设备已退出登录");
      form.reset();
    },
  });

  if (hasPermission("user.forbid_change_own_password")) {
    return null;
  }

  const onSubmit = form.handleSubmit((values) => change.mutate(values));
  const busy = change.isPending;
  const errors = form.formState.errors;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>修改密码</CardTitle>
        <CardDescription>修改成功后，其他已登录的设备将退出登录。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field data-invalid={!!errors.oldPassword}>
            <FieldLabel htmlFor="old-password">旧密码</FieldLabel>
            <Input
              id="old-password"
              type="password"
              autoComplete="current-password"
              {...form.register("oldPassword")}
            />
            {errors.oldPassword && <FieldError>{errors.oldPassword.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.newPassword}>
            <FieldLabel htmlFor="new-password">新密码</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              {...form.register("newPassword")}
            />
            {errors.newPassword && <FieldError>{errors.newPassword.message}</FieldError>}
          </Field>

          {change.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>修改失败</AlertTitle>
              <AlertDescription>{change.error.message}</AlertDescription>
            </Alert>
          )}

          <div>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? "提交中…" : "修改密码"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
