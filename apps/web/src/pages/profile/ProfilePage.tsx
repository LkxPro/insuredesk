import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { ChangePasswordCard } from "./ChangePasswordCard";

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) {
    return null;
  }

  const rows = [
    { label: "用户名", value: user.username },
    { label: "姓名", value: user.name },
    { label: "邮箱", value: user.email ?? "—" },
    { label: "团队", value: user.team ?? "—" },
    { label: "角色", value: user.roleName },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">个人资料</h1>
      <Card className="max-w-xl">
        <CardContent className="flex flex-col gap-3 text-sm">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <ChangePasswordCard />
    </div>
  );
}
