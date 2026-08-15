import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DetailNavStep } from "./detail-navigation";

/** prev/next 翻单按钮：与方向键消费同一份 step 解析，两个详情区共用。 */
export function DetailNavButtons({
  prevStep,
  nextStep,
  onStep,
}: {
  prevStep: DetailNavStep | null;
  nextStep: DetailNavStep | null;
  onStep: (step: DetailNavStep) => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="上一条工单"
        disabled={!prevStep}
        onClick={() => prevStep && onStep(prevStep)}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="下一条工单"
        disabled={!nextStep}
        onClick={() => nextStep && onStep(nextStep)}
      >
        <ChevronDown />
      </Button>
    </>
  );
}
