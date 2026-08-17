import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 草稿不写在 URL 里，提交（回车或点「搜索」）才落入。 */
export function TicketListSearch({
  draft,
  onDraftChange,
  onSubmit,
  placeholder,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
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
          className="h-8 w-60 pl-8"
        />
      </div>
      <Button type="submit" size="sm">
        搜索
      </Button>
    </form>
  );
}
