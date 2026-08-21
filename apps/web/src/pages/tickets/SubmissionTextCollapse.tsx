import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SubmissionTextCollapse({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="h-auto w-fit justify-start gap-1 px-2 py-1 font-medium"
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        工单原文
      </Button>
      {expanded && <pre className="m-0 whitespace-pre-wrap text-sm">{text}</pre>}
    </div>
  );
}
