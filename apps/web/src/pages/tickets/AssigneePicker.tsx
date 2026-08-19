import { CheckIcon, XIcon } from "lucide-react";
import { pinyin } from "pinyin-pro";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { matchName, type NameMatch } from "@/lib/name-match";
import { cn } from "@/lib/utils";
import { MatchHighlight } from "./MatchHighlight";

export type AssigneeOption = { id: string; name: string };

export function AssigneePicker({
  id,
  options,
  value,
  onChange,
  currentAssigneeId,
  disabled,
}: {
  id?: string;
  options: AssigneeOption[];
  value: string;
  onChange: (id: string) => void;
  /** 改派场景置灰当前责任人 — 服务端会拒绝改派给同一人 */
  currentAssigneeId?: string | null;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 候选加载中输入框是 disabled,挂载时焦点会落空 — 等到启用再聚焦
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  // mode "surname": 姓氏多音字按姓氏读法(单 shan / 解 xie / 查 zha)
  const indexed = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        py: pinyin(option.name, { toneType: "none", type: "array", mode: "surname" }),
      })),
    [options],
  );

  const selected = options.find((option) => option.id === value);
  const effectiveQuery = selected && text === selected.name ? "" : text;

  const matches = useMemo(
    () =>
      indexed
        .map((option) => ({ option, match: matchName(option.name, option.py, effectiveQuery) }))
        .filter((entry): entry is { option: (typeof indexed)[number]; match: NameMatch } =>
          Boolean(entry.match),
        )
        .sort((a, b) => b.match.score - a.match.score),
    [indexed, effectiveQuery],
  );

  useEffect(() => {
    listRef.current
      ?.querySelectorAll("[role='option']")
      [activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function choose(option: AssigneeOption) {
    onChange(option.id);
    setText(option.name);
    setListOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = matches[activeIndex];
      if (listOpen && hit && hit.option.id !== currentAssigneeId) {
        choose(hit.option);
      }
    }
    // Esc 只收列表,不冒泡去关整个 dialog
    if (event.key === "Escape" && listOpen) {
      event.stopPropagation();
      setListOpen(false);
    }
  }

  const listboxId = id ? `${id}-listbox` : undefined;
  const activeOption = listOpen ? matches[activeIndex] : undefined;
  const activeDescendant =
    id && activeOption ? `${id}-option-${activeOption.option.id}` : undefined;

  return (
    <div>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={listOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            setActiveIndex(0);
            setListOpen(true);
            if (value) {
              onChange("");
            }
          }}
          onFocus={(event) => {
            setListOpen(true);
            if (selected) {
              event.currentTarget.select();
            }
          }}
          onClick={() => setListOpen(true)}
          onBlur={() => setListOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="输入姓名、拼音或首字母搜索"
          className={cn(value && "pr-8")}
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label="清除选择"
            onClick={() => {
              onChange("");
              setText("");
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      {listOpen && (
        <div
          ref={listRef}
          role="listbox"
          id={listboxId}
          className="mt-1 max-h-60 overflow-y-auto rounded-md border p-1"
        >
          {matches.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">无匹配的责任人</div>
          )}
          {matches.map(({ option, match }, index) => {
            const isCurrent = option.id === currentAssigneeId;
            return (
              <button
                type="button"
                tabIndex={-1}
                key={option.id}
                id={id ? `${id}-option-${option.id}` : undefined}
                role="option"
                aria-selected={option.id === value}
                aria-disabled={isCurrent || undefined}
                // 保持焦点留在输入框,键盘导航不被点击抢走
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => !isCurrent && choose(option)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground",
                  isCurrent && "cursor-not-allowed text-muted-foreground",
                )}
              >
                <CheckIcon
                  className={cn(
                    "size-4 shrink-0",
                    option.id === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="line-clamp-1">
                  <MatchHighlight name={option.name} ranges={match.ranges} />
                  {isCurrent && "（当前责任人）"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
