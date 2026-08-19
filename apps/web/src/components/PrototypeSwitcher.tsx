// 原型（可丢弃）：UI 原型变体切换条，仅开发环境渲染；随原型一起删除。
import { ChevronLeft, ChevronRight, FlaskConical, X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function PrototypeSwitcher({ variants }: { variants: PrototypeVariant[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = searchParams.get("variant");
  const index = variants.findIndex((variant) => variant.key === current);

  const cycle = useCallback(
    (delta: number) => {
      const next =
        index === -1
          ? variants[delta > 0 ? 0 : variants.length - 1]
          : variants[(index + delta + variants.length) % variants.length];
      if (!next) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("variant", next.key);
          return params;
        },
        { replace: true },
      );
    },
    [index, variants, setSearchParams],
  );

  const clear = useCallback(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("variant");
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      event.preventDefault();
      cycle(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  if (import.meta.env.PROD) return null;

  const active = index >= 0 ? variants[index] : null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-2 py-1.5 text-background shadow-lg">
      <FlaskConical className="mx-1 size-4 opacity-70" />
      <button
        type="button"
        aria-label="上一个变体"
        onClick={() => cycle(-1)}
        className="rounded-full p-1 hover:bg-background/20"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-40 text-center text-xs font-medium">
        {active ? `${active.key} — ${active.name}` : "按名称排序原型（未启用）"}
      </span>
      <button
        type="button"
        aria-label="下一个变体"
        onClick={() => cycle(1)}
        className="rounded-full p-1 hover:bg-background/20"
      >
        <ChevronRight className="size-4" />
      </button>
      {active && (
        <button
          type="button"
          aria-label="退出原型"
          onClick={clear}
          className="rounded-full p-1 hover:bg-background/20"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
