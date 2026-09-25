"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * 作品简介。移动端先折到 4 行，点「展开全部」再看全文；
 * 桌面端宽度足够，直接铺开不受行数限制。
 *
 * 折叠按钮只在「确实被截断」时出现——先量一次折叠态下的 scrollHeight，
 * 短简介不显示按钮，免得点开什么也没多出来。桌面端不折行，
 * scrollHeight 与 clientHeight 相等，按钮自然消失，不用额外写断点判断。
 */
export function WorkOverview({ overview }: { overview: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [overview]);

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-4">
      <p className="text-xs font-medium text-muted-foreground">简介</p>
      <p
        ref={ref}
        className={`max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 ${
          expanded ? "" : "line-clamp-4 sm:line-clamp-none"
        }`}
      >
        {overview}
      </p>
      {clamped ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary outline-none hover:underline focus-visible:underline sm:hidden"
        >
          {expanded ? (
            <>
              收起 <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              展开全部 <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
