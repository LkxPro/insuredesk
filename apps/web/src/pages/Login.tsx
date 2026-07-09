import { FullScreenLoading } from "@/components/FullScreenLoading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { zodResolver } from "@hookform/resolvers/zod";
import { type LoginBody, loginBodySchema } from "@insuredesk/shared";
import { useForm } from "react-hook-form";
import { type Location, Navigate, useLocation, useNavigate } from "react-router";

/** Where to go after login: back to the guarded page we bounced off, or home. */
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

  // Already logged in — nothing to do here.
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
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">InsureDesk</CardTitle>
          <CardDescription>登录客服工单系统</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">用户名</Label>
              <Input id="username" autoComplete="username" {...register("username")} />
              {errors.username && (
                <p className="text-sm text-destructive">{errors.username.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "登录中…" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
