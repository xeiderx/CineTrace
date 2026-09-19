"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MATCH_STATUS_LABELS,
  MATCH_STATUS_ORDER,
  MEDIA_TYPE_LABELS,
  VIEW_STATUS_LABELS,
  VIEW_STATUS_ORDER,
} from "@/lib/labels";
import type { FacetItem } from "@/lib/queries";

const ALL = "all";

/** 下拉里带数量的选项文案，如「恐怖 (23)」 */
function facetLabel(item: FacetItem): string {
  return `${item.value} (${item.count})`;
}

/**
 * 档案库筛选栏：搜索词与下拉条件全部体现在 URL 上，便于分享与刷新保持。
 * 国家与类型两个下拉的取值来自库内实际分布，已按作品数由多到少排好。
 */
export function LibraryFilters({
  countries,
  genres,
}: {
  countries: FacetItem[];
  genres: FacetItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const mediaType = searchParams.get("type") ?? ALL;
  const status = searchParams.get("status") ?? ALL;
  const matchStatus = searchParams.get("match") ?? ALL;
  const country = searchParams.get("country") ?? ALL;
  const genre = searchParams.get("genre") ?? ALL;
  const sort = searchParams.get("sort") ?? "recent";

  const [draft, setDraft] = useState(q);
  const [syncedQuery, setSyncedQuery] = useState(q);

  // 外部（如浏览器前进后退）改变 URL 时同步输入框。
  // 用渲染期比对代替 effect，避免级联渲染。
  if (syncedQuery !== q) {
    setSyncedQuery(q);
    setDraft(q);
  }

  function apply(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    startTransition(() => router.replace(query ? `/library?${query}` : "/library"));
  }

  const hasFilter =
    q !== "" ||
    mediaType !== ALL ||
    status !== ALL ||
    matchStatus !== ALL ||
    country !== ALL ||
    genre !== ALL ||
    sort !== "recent";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-52 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: draft.trim() || null });
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="搜索片名、原名、豆瓣或 IMDb 编号"
          className="h-9 pl-9"
          aria-label="搜索作品"
        />
        {draft ? (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => {
              setDraft("");
              apply({ q: null });
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </form>

      <Select value={mediaType} onValueChange={(v) => apply({ type: v })}>
        <SelectTrigger className="h-9 w-28" aria-label="媒体类型筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部媒体</SelectItem>
          {Object.entries(MEDIA_TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(v) => apply({ status: v })}>
        <SelectTrigger className="h-9 w-28" aria-label="状态筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部状态</SelectItem>
          {VIEW_STATUS_ORDER.map((value) => (
            <SelectItem key={value} value={value}>
              {VIEW_STATUS_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={matchStatus} onValueChange={(v) => apply({ match: v })}>
        <SelectTrigger className="h-9 w-28" aria-label="匹配状态筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部匹配</SelectItem>
          {MATCH_STATUS_ORDER.map((value) => (
            <SelectItem key={value} value={value}>
              {MATCH_STATUS_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={genre} onValueChange={(v) => apply({ genre: v })}>
        <SelectTrigger className="h-9 w-32" aria-label="类型筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部类型</SelectItem>
          {genres.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {facetLabel(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={country} onValueChange={(v) => apply({ country: v })}>
        <SelectTrigger className="h-9 w-32" aria-label="国家筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部国家</SelectItem>
          {countries.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {facetLabel(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={(v) => apply({ sort: v })}>
        <SelectTrigger className="h-9 w-32" aria-label="排序方式">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">最近观看</SelectItem>
          <SelectItem value="rating">评分最高</SelectItem>
          <SelectItem value="title">按片名</SelectItem>
          <SelectItem value="year">按年份</SelectItem>
        </SelectContent>
      </Select>

      {hasFilter ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          disabled={pending}
          onClick={() => startTransition(() => router.replace("/library"))}
        >
          重置
        </Button>
      ) : null}
    </div>
  );
}
