import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ShieldX } from "lucide-react";
import { Link } from "react-router";

export function Forbidden() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldX />
          </EmptyMedia>
          <EmptyTitle>403</EmptyTitle>
          <EmptyDescription>你没有访问该页面的权限</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to="/">返回首页</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
