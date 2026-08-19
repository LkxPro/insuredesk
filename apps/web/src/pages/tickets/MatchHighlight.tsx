import type { ReactNode } from "react";
import type { MatchRange } from "@/lib/name-match";

export function MatchHighlight({ name, ranges }: { name: string; ranges: MatchRange[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end]) => {
    if (start > cursor) {
      parts.push(name.slice(cursor, start));
    }
    parts.push(
      <mark key={start} className="rounded-[2px] bg-amber-200 text-inherit dark:bg-amber-400/40">
        {name.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  parts.push(name.slice(cursor));
  return <>{parts}</>;
}
