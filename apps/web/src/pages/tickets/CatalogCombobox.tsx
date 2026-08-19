import { pinyin } from "pinyin-pro";
import { useCallback, useMemo, useRef, useState } from "react";
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

export type CatalogComboboxOption = { id: string; name: string };

/**
 * 目录类字段（客诉类别/投诉渠道）的单选搜索框：中文子串 / 全拼连打 / 首字母
 * 连打匹配（name-match），命中片段高亮。value 为目录 id，"" 表示未设置。
 *
 * items 恒为全量、过滤走 Base UI 的 filter 回调——外部派生 items 会触发
 * Base UI 的 items-watch 把输入同步回已选标签，输入即被清空。
 *
 * 弹层 portal 进自身容器而非 body：Radix modal Dialog 给 body 上
 * pointer-events:none 并用 react-remove-scroll 锁外部滚动，portal 到 body
 * 的弹层在弹窗里点不动也滚不动。
 */
export function CatalogCombobox({
  id,
  options,
  value,
  onChange,
  invalid,
  placeholder = "请选择",
}: {
  id?: string;
  options: readonly CatalogComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

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
    (option: CatalogComboboxOption, q: string) =>
      matchName(option.name, pyById.get(option.id) ?? [], q) !== null,
    [pyById],
  );

  const selected = options.find((option) => option.id === value) ?? null;
  // Base UI 选中后把输入框回填为已选名称
  const highlightQuery = selected && query === selected.name ? "" : query;

  return (
    <div ref={containerRef}>
      <Combobox<CatalogComboboxOption>
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
          id={id}
          aria-invalid={invalid}
          placeholder={placeholder}
          showClear
          autoComplete="off"
          className="w-full"
        />
        <ComboboxContent container={containerRef} className="w-auto">
          <ComboboxEmpty>无匹配项</ComboboxEmpty>
          <ComboboxList>
            {(option: CatalogComboboxOption) => (
              <ComboboxItem key={option.id} value={option}>
                {/* flex 容器下裸文本与 <mark> 会各自成为 flex item 被 gap 隔开，收进一个 span */}
                <span className="line-clamp-1">
                  <MatchHighlight
                    name={option.name}
                    ranges={
                      matchName(option.name, pyById.get(option.id) ?? [], highlightQuery)?.ranges ??
                      []
                    }
                  />
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
