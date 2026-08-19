import { pinyin } from "pinyin-pro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { matchName } from "@/lib/name-match";
import { MatchHighlight } from "./MatchHighlight";

export type SearchableComboboxOption = { id: string; name: string };

/**
 * items 恒为全量、过滤走 Base UI 的 filter 回调——外部派生 items 会触发
 * Base UI 的 items-watch 把输入同步回已选标签,输入即被清空。
 *
 * 弹层 portal 进自身容器而非 body:Radix modal Dialog 给 body 上
 * pointer-events:none 并用 react-remove-scroll 锁外部滚动,portal 到 body
 * 的弹层在弹窗里点不动也滚不动。
 */
export function SearchableCombobox({
  id,
  options,
  value,
  onChange,
  invalid,
  placeholder = "请选择",
  emptyText = "无匹配项",
  disabled = false,
  autoFocus = false,
  disabledReason,
}: {
  id?: string;
  options: readonly SearchableComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** options 异步加载时输入框先 disabled,挂载焦点落空——enabled 后再聚焦 */
  autoFocus?: boolean;
  disabledReason?: (option: SearchableComboboxOption) => string | null;
}) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRef.current?.focus();
    }
  }, [autoFocus, disabled]);

  // mode "surname": 姓氏多音字按姓氏读法
  const pyById = useMemo(
    () =>
      new Map(
        options.map((option) => [
          option.id,
          pinyin(option.name, { toneType: "none", type: "array", mode: "surname" }),
        ]),
      ),
    [options],
  );

  const filter = useCallback(
    (option: SearchableComboboxOption, q: string) =>
      matchName(option.name, pyById.get(option.id) ?? [], q) !== null,
    [pyById],
  );

  const selected = options.find((option) => option.id === value) ?? null;
  // Base UI 选中后把输入框回填为已选名称
  const highlightQuery = selected && query === selected.name ? "" : query;

  return (
    <div ref={containerRef}>
      <Combobox<SearchableComboboxOption>
        items={options}
        filter={filter}
        autoHighlight
        value={selected}
        onValueChange={(next) => onChange(next?.id ?? "")}
        onInputValueChange={setQuery}
        isItemEqualToValue={(a, b) => a.id === b.id}
        itemToStringLabel={(option) => option.name}
      >
        <ComboboxInput
          ref={inputRef}
          id={id}
          aria-invalid={invalid}
          placeholder={placeholder}
          showClear
          autoComplete="off"
          disabled={disabled}
          className="w-full"
        />
        <ComboboxContent container={containerRef} className="w-auto">
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxList>
            {(option: SearchableComboboxOption) => {
              const reason = disabledReason?.(option) ?? null;
              return (
                <ComboboxItem key={option.id} value={option} disabled={reason !== null}>
                  {/* flex 容器下裸文本与 <mark> 会各自成为 flex item 被 gap 隔开,收进一个 span */}
                  <span className="line-clamp-1">
                    <MatchHighlight
                      name={option.name}
                      ranges={
                        matchName(option.name, pyById.get(option.id) ?? [], highlightQuery)
                          ?.ranges ?? []
                      }
                    />
                    {reason !== null && `（${reason}）`}
                  </span>
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
