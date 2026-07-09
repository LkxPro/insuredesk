import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Plus } from "lucide-react";
import { Link } from "react-router";

/**
 * 工单管理 landing page. The list itself is a later ticket; this page carries
 * the creation entry point, shown only to holders of ticket.create (the API
 * enforces the same permission independently).
 */
export function TicketsPage() {
  const { hasPermission } = useAuth();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">工单管理</h1>
        {hasPermission("ticket.create") && (
          <Button asChild>
            <Link to="/tickets/new">
              <Plus />
              新建工单
            </Link>
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">工单列表功能开发中，敬请期待。</p>
    </div>
  );
}
