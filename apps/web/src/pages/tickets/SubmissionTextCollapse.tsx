import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * 只读态工单原文折叠块：默认收起，点开显示全文，避免大段原文挤占客户信息流。
 * 只在外部件（source=external_channel）且 submissionText 非空时渲染。
 */
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
