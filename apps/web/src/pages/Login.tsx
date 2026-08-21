import { zodResolver } from "@hookform/resolvers/zod";
import { type LoginBody, loginBodySchema } from "@insuredesk/shared";
import { AlertCircle, LifeBuoy } from "lucide-react";
import { useForm } from "react-hook-form";
import { type Location, Navigate, useLocation, useNavigate } from "react-router";
import { FullScreenLoading } from "@/components/FullScreenLoading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";

function fromPathname(location: Location): string {
  const state = location.state as { from?: Location } | null;
  return state?.from?.pathname ?? "/";
}

export function Login() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginBody>({ resolver: zodResolver(loginBodySchema) });

  if (isLoading) {
    return <FullScreenLoading />;
  }

  if (user) {
    return <Navigate to={fromPathname(location)} replace />;
  }

  const onSubmit = handleSubmit(async ({ username, password }) => {
    try {
      const result = await login(username, password);
      if (result.ok) {
        navigate(fromPathname(location), { replace: true });
      } else {
        setError("root", { message: result.error });
      }
    } catch {
      setError("root", { message: "网络错误，请稍后重试" });
    }
  });

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted px-6 dark:bg-background">
      <div className="flex items-center gap-2 font-semibold">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LifeBuoy className="size-4" />
        </div>
        InsureDesk
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">欢迎回来</CardTitle>
          <CardDescription>登录客服工单系统</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup className="gap-5">
              <Field data-invalid={!!errors.username}>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  aria-invalid={!!errors.username}
                  {...register("username")}
                />
                <FieldError errors={[errors.username]} />
              </Field>
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                <FieldError errors={[errors.password]} />
              </Field>

              {errors.root && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner data-icon="inline-start" />}
                {isSubmitting ? "登录中…" : "登录"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
