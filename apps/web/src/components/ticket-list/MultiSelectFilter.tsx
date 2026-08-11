import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * 列表筛选多选组件：触发器常驻显示维度名 + 已选计数徽标，弹层内逐项勾选，
 * 顶部提供全选/清空快捷操作。空选 = 全部（不过滤），触发器不挂徽标。
 */
export function MultiSelectFilter({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: readonly string[];
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
}) {
  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  return (
    <Popover>
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
        <div className="flex items-center justify-between px-1 pb-1">
          <Button variant="ghost" size="sm" onClick={() => onChange(options.map((o) => o.value))}>
            全选
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            清空
          </Button>
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {options.map((option) => (
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
      </PopoverContent>
    </Popover>
  );
}
