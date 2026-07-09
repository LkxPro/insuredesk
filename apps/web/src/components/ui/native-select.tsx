import { cn } from "@/lib/utils";
import type * as React from "react";

/**
 * Styled native `<select>`: register()-compatible with react-hook-form and
 * dependency-free, unlike the Radix-based shadcn Select. Enough for the
 * enum dropdowns this phase.
 */
export function NativeSelect({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-background",
        className,
      )}
      {...props}
    />
  );
}
