import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function MultiSelectFilter({
  label,
  values,
  options,
  onChange,
  searchable = false,
}: {
  label: string;
  values: readonly string[];
  options: ReadonlyArray<{ value: string; label: string; searchText?: string }>;
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visibleOptions = searchable
    ? options.filter((option) => (option.searchText ?? option.label).toLowerCase().includes(query))
    : options;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  function selectAll() {
    if (!searchable) {
      onChange(options.map((option) => option.value));
      return;
    }
    const nextValues = [...new Set([...visibleOptions.map((option) => option.value), ...values])];
    if (nextValues.length !== values.length) onChange(nextValues);
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} className="font-normal">
          {label}
          {values.length > 0 && (
            <Badge variant="secondary" className="tabular-nums" aria-hidden>
              {values.length}
            </Badge>
          )}
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {searchable && (
          <div className="p-1">
            <Input
              type="search"
              aria-label={`搜索${label}`}
              placeholder={`搜索${label}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8"
            />
          </div>
        )}
        <div className="flex items-center justify-between px-1 pb-1">
          <Button variant="ghost" size="sm" onClick={selectAll}>
            全选
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            清空
          </Button>
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {visibleOptions.map((option) => (
            <li key={option.value}>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox 渲染为 button（可标签元素），整行点击经 label 激活它；biome 只认原生 input */}
              <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox
                  checked={values.includes(option.value)}
                  onCheckedChange={() => toggle(option.value)}
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {searchable && visibleOptions.length === 0 && (
          <Empty role="status" className="p-2 md:p-2">
            <EmptyDescription>未找到{label}</EmptyDescription>
          </Empty>
        )}
      </PopoverContent>
    </Popover>
  );
}
