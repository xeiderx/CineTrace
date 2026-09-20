"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * 生成页码序列，页数多时用 -1 表示省略号。
 * 首尾页恒定可见，当前页左右各留一页，便于小幅前后翻动。
 */
function buildPageItems(current: number, pageCount: number): number[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const items = new Set<number>([1, pageCount, current]);
  for (const offset of [-1, 1]) {
    const page = current + offset;
    if (page >= 1 && page <= pageCount) items.add(page);
  }

  const sorted = [...items].sort((a, b) => a - b);
  const result: number[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push(-1);
    result.push(page);
    previous = page;
  }
  return result;
}

/**
 * 档案库分页导航。
 *
 * 页码写进 URL 的 `page` 参数而非组件状态：
 * 刷新、分享链接、浏览器前进后退都能回到同一页，
 * 与筛选条件（q / type / status …）拼在同一个 queryString 里天然共存。
 */
export function LibraryPagination({
  page,
  pageCount,
}: {
  page: number;
  pageCount: number;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  if (pageCount <= 1) return null;

  function hrefFor(target: number): string {
    const params = new URLSearchParams(searchParams.toString());
    // 第一页不写 page，保持链接干净
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    const query = params.toString();
    return query ? `/library?${query}` : "/library";
  }

  const items = buildPageItems(page, pageCount);
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  // 控制按钮与页码统一样式；当前页不可点，避免无意义的重复跳转
  const stepClass = cn(
    "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-sm",
    "outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
  );

  return (
    <nav
      aria-label="分页导航"
      className="mt-8 flex flex-wrap items-center justify-center gap-2"
    >
      {hasPrevious ? (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          aria-label="上一页"
          className={cn(stepClass, "hover:bg-muted")}
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">上一页</span>
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(stepClass, "cursor-not-allowed opacity-40")}
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">上一页</span>
        </span>
      )}

      {/* 页码按钮在窄屏上放不下，移动端改用下方下拉跳页 */}
      <ul className="hidden items-center gap-1 sm:flex">
        {items.map((item, index) =>
          item === -1 ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-sm text-muted-foreground"
            >
              …
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span
                  aria-current="page"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-primary px-2 text-sm font-medium text-primary-foreground"
                >
                  {item}
                </span>
              ) : (
                <Link
                  href={hrefFor(item)}
                  aria-label={`第 ${item} 页`}
                  className={cn(stepClass, "min-w-9 justify-center hover:bg-muted")}
                >
                  {item}
                </Link>
              )}
            </li>
          ),
        )}
      </ul>

      {/* 窄屏放不下页码列表，改为下拉直接跳页，避免大库时反复点「下一页」 */}
      <div className="sm:hidden">
        <Select
          value={String(page)}
          onValueChange={(value) => router.push(hrefFor(Number(value)))}
        >
          <SelectTrigger className="h-9 w-32" aria-label="选择页码">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((value) => (
              <SelectItem key={value} value={String(value)}>
                第 {value} / {pageCount} 页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasNext ? (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          aria-label="下一页"
          className={cn(stepClass, "hover:bg-muted")}
        >
          <span className="hidden sm:inline">下一页</span>
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(stepClass, "cursor-not-allowed opacity-40")}
        >
          <span className="hidden sm:inline">下一页</span>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
