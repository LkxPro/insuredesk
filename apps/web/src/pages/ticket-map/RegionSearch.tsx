import type { RegionNode } from "@insuredesk/shared/region";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useRegionModule } from "@/pages/tickets/RegionCascader";
import {
  flattenRegionPaths,
  type RegionPath,
  regionPathLabel,
  searchRegionPaths,
} from "./region-search";

export function RegionSearch({
  value,
  onSelect,
  onClear,
}: {
  value: readonly string[];
  onSelect: (path: RegionPath) => void;
  onClear: () => void;
}) {
  const regions = useRegionModule();
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState<RegionPath>([]);
  const [active, setActive] = useState(0);

  const paths = useMemo(
    () => (regions ? flattenRegionPaths(regions.REGION_PROVINCES) : []),
    [regions],
  );
  const selected = useMemo(
    () =>
      regions
        ? value.map((code) => regions.findRegion(code)).filter((node): node is RegionNode => !!node)
        : [],
    [regions, value],
  );

  const searching = text !== null && text.trim() !== "";
  const items = useMemo((): RegionPath[] => {
    if (searching) return searchRegionPaths(text, paths);
    const options = browse.at(-1)?.children ?? regions?.REGION_PROVINCES ?? [];
    return options.map((node) => [...browse, node]);
  }, [searching, text, paths, browse, regions]);

  const close = () => {
    setOpen(false);
    setText(null);
  };

  const choose = (path: RegionPath) => {
    onSelect(path);
    setText(null);
    setActive(0);
    if (!searching && (path.at(-1)?.children.length ?? 0) > 0) {
      setBrowse(path);
    } else {
      setOpen(false);
    }
  };

  const toggleBrowse = () => {
    if (open) {
      close();
      return;
    }
    const leaf = selected.at(-1);
    setBrowse(leaf && leaf.children.length === 0 ? selected.slice(0, -1) : selected);
    setText(null);
    setActive(0);
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (items.length === 0 ? 0 : (index + step + items.length) % items.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const path = items[active];
      if (open && path) choose(path);
    } else if (event.key === "Escape") {
      close();
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverAnchor asChild>
        <InputGroup ref={anchorRef} className="h-8">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            role="combobox"
            aria-label="搜索地区"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="搜索：xx省xx市xx区"
            disabled={!regions}
            value={text ?? regionPathLabel(selected)}
            onChange={(event) => {
              setText(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={(event) => event.target.select()}
            onKeyDown={onKeyDown}
          />
          <InputGroupAddon align="inline-end">
            {(selected.length > 0 || searching) && (
              <InputGroupButton
                size="icon-xs"
                aria-label="清除地区"
                onClick={() => {
                  close();
                  onClear();
                }}
              >
                <X />
              </InputGroupButton>
            )}
            <InputGroupButton
              size="icon-xs"
              aria-label="选择地区"
              disabled={!regions}
              onClick={toggleBrowse}
            >
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        {!searching && (
          <div className="flex flex-wrap items-center gap-0.5 border-b px-1 pb-1 text-xs">
            {[null, ...browse].map((node, index) => (
              <button
                key={node?.code ?? "all"}
                type="button"
                className="flex items-center rounded px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setBrowse(browse.slice(0, index));
                  setActive(0);
                }}
              >
                {index > 0 && <ChevronRight className="mr-0.5 size-3" />}
                {node?.name ?? "全国"}
              </button>
            ))}
          </div>
        )}
        <div id={listId} role="listbox" aria-label="地区" className="max-h-72 overflow-y-auto pt-1">
          {items.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">无匹配地区</p>
          ) : (
            items.map((path, index) => {
              const leaf = path.at(-1) as RegionNode;
              const parents = path.slice(0, -1);
              return (
                <div
                  key={leaf.code}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === active}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm",
                    index === active && "bg-accent",
                  )}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(path)}
                  onKeyDown={() => {}}
                >
                  <span className="truncate">
                    {searching && parents.length > 0 && (
                      <span className="text-muted-foreground">{regionPathLabel(parents)} </span>
                    )}
                    {leaf.name}
                  </span>
                  {!searching && leaf.children.length > 0 && (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
