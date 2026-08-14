import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { type ToastItem, type ToastKind, toastStore } from "@/lib/toast-store";

/**
 * 轻提示宿主：顶部正中央的胶囊队列，不自动消失，逐条带关闭键。
 * 平时只显示最新一条；多条时折叠为「N 条」徽标，点开逐条查看/关闭。
 * 带 onClick 的条目点击本体即触发（如跳转对应页面）并随之关闭。
 */

const KIND_ICON = {
  success: CircleCheckIcon,
  error: OctagonXIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
} as const;

const KIND_COLOR: Record<ToastKind, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  warning: "text-amber-500 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
};

function CloseButton({ id }: { id: number }) {
  return (
    <button
      type="button"
      aria-label="关闭通知"
      onClick={() => toastStore.dismiss(id)}
      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <XIcon className="size-3.5" />
    </button>
  );
}

/** 通知本体：带 onClick 时是按钮，否则纯文本。 */
function ItemBody({ item, className }: { item: ToastItem; className?: string }) {
  const text = (
    <>
      <span className="font-medium">{item.message}</span>
      {item.description && <span className="text-muted-foreground"> · {item.description}</span>}
    </>
  );
  if (!item.onClick) {
    return <span className={className}>{text}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        item.onClick?.();
        toastStore.dismiss(item.id);
      }}
      className={`${className ?? ""} cursor-pointer text-left hover:underline`}
    >
      {text}
    </button>
  );
}

export function ToastHost() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getItems);
  const [expanded, setExpanded] = useState(false);
  const latest = items[items.length - 1];

  if (!latest) {
    return null;
  }
  const LatestIcon = KIND_ICON[latest.kind];

  return (
    <div
      aria-live="polite"
      className="fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 flex-col items-center"
    >
      <div className="flex max-w-[min(90vw,28rem)] items-center gap-2 rounded-full border bg-popover py-2 pl-4 pr-2 text-sm text-popover-foreground shadow-lg animate-in slide-in-from-top-2 fade-in duration-300">
        <LatestIcon className={`size-4 shrink-0 ${KIND_COLOR[latest.kind]}`} />
        <ItemBody item={latest} className="truncate" />
        {items.length > 1 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {items.length} 条
            {expanded ? (
              <ChevronUpIcon className="size-3" />
            ) : (
              <ChevronDownIcon className="size-3" />
            )}
          </button>
        )}
        <CloseButton id={latest.id} />
      </div>
      {expanded && items.length > 1 && (
        <ul
          aria-label="待处理通知"
          className="mt-2 flex max-h-80 w-96 max-w-[90vw] flex-col gap-0.5 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg animate-in slide-in-from-top-2 fade-in duration-200"
        >
          {[...items].reverse().map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/50"
              >
                <Icon className={`size-4 shrink-0 ${KIND_COLOR[item.kind]}`} />
                <ItemBody item={item} className="min-w-0 flex-1" />
                <CloseButton id={item.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
