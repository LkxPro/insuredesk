import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Ticket } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { TicketCreateDialog } from "./TicketCreateDialog";

/**
 * 工单管理 landing page. The list itself is a later ticket; this page carries
 * the creation entry point, shown only to holders of ticket.create (the API
 * enforces the same permission independently).
 *
 * Creation is a modal dialog over this page, driven by the /tickets/new route
 * (`createOpen`): the URL stays deep-linkable, the route guard keeps enforcing
 * ticket.create, and the browser back button closes the dialog.
 */
export function TicketsPage({ createOpen = false }: { createOpen?: boolean }) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasPermission("ticket.create");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">工单管理</h1>
          <p className="text-sm text-muted-foreground">客诉工单的创建、分配与跟进。</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link to="/tickets/new">
              <Plus data-icon="inline-start" />
              新建工单
            </Link>
          </Button>
        )}
      </div>

      <Empty className="flex-1 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Ticket />
          </EmptyMedia>
          <EmptyTitle>工单列表开发中</EmptyTitle>
          <EmptyDescription>列表功能即将上线，敬请期待。</EmptyDescription>
        </EmptyHeader>
      </Empty>

      {canCreate && (
        <TicketCreateDialog
          open={createOpen}
          onOpenChange={(open) => {
            if (!open) navigate("/tickets");
          }}
        />
      )}
    </div>
  );
}
