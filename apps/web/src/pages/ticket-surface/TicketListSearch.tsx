import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TicketListSearch({
  draft,
  onDraftChange,
  onSubmit,
  onClear,
  placeholder,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={placeholder}
          // 浏览器原生 search 清除钮风格突兀，藏掉换下方自绘的 X
          className="h-8 w-60 pl-8 pr-7 [&::-webkit-search-cancel-button]:hidden"
        />
        {draft.length > 0 && (
          <button
            type="button"
            aria-label="清除搜索"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Button type="submit" size="sm">
        搜索
      </Button>
    </form>
  );
}
