import { ChevronLeft, ChevronRight, FlaskConical } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";

export interface VariantMeta {
  key: string;
  name: string;
}

/** 原型切换条：浮在页面底部中央，←/→ 或箭头键切换变体；生产构建不渲染。 */
export function PrototypeSwitcher({
  variants,
  current,
  stress,
  onToggleStress,
}: {
  variants: VariantMeta[];
  current: string;
  stress: boolean;
  onToggleStress: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  function cycle(dir: 1 | -1) {
    const next = variants[(index + dir + variants.length) % variants.length];
    if (!next) return;
    const params = new URLSearchParams(searchParams);
    params.set("variant", next.key);
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-foreground px-2 py-1.5 text-background shadow-lg">
      <FlaskConical className="mx-1 size-4 opacity-70" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="上一个变体"
        className="text-background hover:bg-background/20 hover:text-background"
        onClick={() => cycle(-1)}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-28 text-center text-sm font-medium">
        {variants[index]?.key} · {variants[index]?.name}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="下一个变体"
        className="text-background hover:bg-background/20 hover:text-background"
        onClick={() => cycle(1)}
      >
        <ChevronRight />
      </Button>
      <div className="mx-1 h-4 w-px bg-background/30" />
      <button
        type="button"
        onClick={onToggleStress}
        className="rounded-full px-2 py-1 text-xs opacity-80 hover:opacity-100"
      >
        数据量：{stress ? "模拟 24 条" : "真实"}
      </button>
    </div>
  );
}
