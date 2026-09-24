"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckIcon, ChevronDownIcon, Search, X } from "lucide-react";
import { useState, useTransition } from "react";
import { ChannelIcon } from "@/components/library/channel-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DOUBAN_REMOVED_FILTER,
  DOUBAN_REMOVED_LABEL,
  MATCH_FILTER_OPTIONS,
  MEDIA_TYPE_LABELS,
  VIEW_STATUS_LABELS,
  VIEW_STATUS_ORDER,
} from "@/lib/labels";
import type { FacetItem, SourceChannelNode } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ALL = "all";

/** 国家下拉默认只列作品最多的前几个，其余收进「更多」——几十个选项一次铺开光滚动就够碍事 */
const COUNTRY_TOP_COUNT = 10;

/** 「更多国家」的哨兵值。它不是真的筛选项，任何情况下都不该落到 URL 上 */
const SHOW_MORE_COUNTRIES = "__more_countries__";

/** 类型下拉与国家同样只列前十个，其余收进「更多」——类型也有几十个，铺开一样碍事 */
const GENRE_TOP_COUNT = 10;

/** 「更多类型」的哨兵值，同「更多国家」，不落到 URL 上 */
const SHOW_MORE_GENRES = "__more_genres__";

/** 下拉里带数量的选项文案，如「恐怖 (23)」 */
function facetLabel(item: FacetItem): string {
  return `${item.value} (${item.count})`;
}

/**
 * 来源渠道筛选。
 *
 * 渠道是两级的，若平铺成几十个选项会比其他下拉长出一截，因此这里默认只列一级大类，
 * 二级全部收进子菜单——和详情页的选择器保持同一套展开逻辑。选中一级等于选中它整个大类
 * （查询侧会把二级一并算进来）。
 */
function ChannelFilter({
  channels,
  value,
  onChange,
}: {
  channels: SourceChannelNode[];
  value: string;
  onChange: (next: string | null) => void;
}) {
  const selected =
    value === ALL
      ? null
      : channels.find((node) => String(node.id) === value) ??
        channels.find((node) => node.children.some((c) => String(c.id) === value)) ??
        null;
  const selectedChild = selected?.children.find((c) => String(c.id) === value) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="来源渠道筛选"
        className={cn(
          "inline-flex h-9 w-32 shrink-0 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm outline-none",
          "transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        {selected ? (
          <ChannelIcon
            icon={selectedChild?.iconData ?? selected.iconData}
            color={selectedChild?.color ?? selected.color}
          />
        ) : null}
        <span className="truncate">
          {selectedChild ? selectedChild.name : (selected?.name ?? "全部渠道")}
        </span>
        <ChevronDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className="text-muted-foreground">全部渠道</span>
          {value === ALL ? (
            <CheckIcon className="ml-auto size-4 text-muted-foreground" />
          ) : null}
        </DropdownMenuItem>

        {channels.length > 0 ? <DropdownMenuSeparator /> : null}

        {channels.map((node) => {
          // 默认只列一级大类，二级收进子菜单——和详情页选择器同一套展开逻辑。
          // 一级本身也能筛，所以子菜单里先放它的「整个大类」
          const nodeActive = value === String(node.id);
          return node.children.length > 0 ? (
            <DropdownMenuSub key={node.id}>
              <DropdownMenuSubTrigger>
                <ChannelIcon icon={node.iconData} color={node.color} />
                <span className="truncate">{node.name}</span>
                {nodeActive ? <CheckIcon className="size-4" /> : null}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem onSelect={() => onChange(String(node.id))}>
                  <ChannelIcon icon={node.iconData} color={node.color} />
                  <span>整个大类</span>
                  {nodeActive ? <CheckIcon className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {node.children.map((child) => (
                  <DropdownMenuItem
                    key={child.id}
                    onSelect={() => onChange(String(child.id))}
                  >
                    <ChannelIcon icon={child.iconData} color={child.color} />
                    <span className="truncate">{child.name}</span>
                    {value === String(child.id) ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem key={node.id} onSelect={() => onChange(String(node.id))}>
              <ChannelIcon icon={node.iconData} color={node.color} />
              <span className="truncate">{node.name}</span>
              {nodeActive ? <CheckIcon className="ml-auto size-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 档案库筛选栏：搜索词与下拉条件全部体现在 URL 上，便于分享与刷新保持。
 * 国家与类型两个下拉的取值来自库内实际分布，已按作品数由多到少排好。
 */
export function LibraryFilters({
  countries,
  genres,
  channels,
}: {
  countries: FacetItem[];
  genres: FacetItem[];
  channels: SourceChannelNode[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const mediaType = searchParams.get("type") ?? ALL;
  const status = searchParams.get("status") ?? ALL;
  const matchStatus = searchParams.get("match") ?? ALL;
  const removed = searchParams.get("removed") ?? ALL;
  const country = searchParams.get("country") ?? ALL;
  const genre = searchParams.get("genre") ?? ALL;
  const channel = searchParams.get("channel") ?? ALL;
  const sort = searchParams.get("sort") ?? "recent";

  const [draft, setDraft] = useState(q);
  const [syncedQuery, setSyncedQuery] = useState(q);
  const [showAllCountries, setShowAllCountries] = useState(false);
  const [showAllGenres, setShowAllGenres] = useState(false);

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
    // 条件或排序一变，原页码就失去意义，回到第一页，
    // 否则可能停在越界页看到空白
    params.delete("page");
    const query = params.toString();
    startTransition(() => router.replace(query ? `/library?${query}` : "/library"));
  }

  const hasFilter =
    q !== "" ||
    mediaType !== ALL ||
    status !== ALL ||
    matchStatus !== ALL ||
    removed !== ALL ||
    country !== ALL ||
    genre !== ALL ||
    channel !== ALL ||
    sort !== "recent";

  // 国家下拉平时只挂前 COUNTRY_TOP_COUNT 个，其余点「更多国家」再铺开。
  // 若当前选中的国家不在这批里，得把它插进来，否则触发器找不到对应文案会显示成空白
  const topCountries = countries.slice(0, COUNTRY_TOP_COUNT);
  const selectedCountry = countries.find((item) => item.value === country);
  const visibleCountries = showAllCountries
    ? countries
    : selectedCountry && !topCountries.includes(selectedCountry)
      ? [...topCountries, selectedCountry]
      : topCountries;
  const hasMoreCountries = countries.length > COUNTRY_TOP_COUNT;

  // 类型与国家同一套：平时只挂前十个，其余点「更多类型」再铺开；
  // 选中的那个若不在前十，也得插进来，否则触发器找不到文案会显示空白
  const topGenres = genres.slice(0, GENRE_TOP_COUNT);
  const selectedGenre = genres.find((item) => item.value === genre);
  const visibleGenres = showAllGenres
    ? genres
    : selectedGenre && !topGenres.includes(selectedGenre)
      ? [...topGenres, selectedGenre]
      : topGenres;
  const hasMoreGenres = genres.length > GENRE_TOP_COUNT;

  return (
    // 窄屏分两行：搜索独占一行，其余控件在下一行横向滑动——七八个下拉铺开要占三四行，
    // 把列表顶下去一大截。宽屏空间够，回到自动换行一次看全。
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <form
        className="relative w-full sm:min-w-52 sm:flex-1"
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

      {/*
        窄屏把这一排控件收进一条横向滑动的轨道，滑不到的头尾用负边距顶到屏幕边缘，
        让人一眼看出右边还有内容。宽屏解除限制，照旧自动换行。
      */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        <Select value={mediaType} onValueChange={(v) => apply({ type: v })}>
          <SelectTrigger
            className="h-9 w-28 shrink-0"
            aria-label="媒体类型筛选"
          >
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
          <SelectTrigger className="h-9 w-28 shrink-0" aria-label="状态筛选">
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

        {/*
          「豆瓣已移除」并进这个下拉，列在「自由添加」之后。它俩在 URL 上是两个参数
          （removed 与 match），所以选中时要把另一个清掉，否则会叠成「既匹配又移除」的空结果。
        */}
        <Select
          value={removed !== ALL ? removed : matchStatus}
          onValueChange={(v) =>
            v === DOUBAN_REMOVED_FILTER
              ? apply({ removed: v, match: null })
              : apply({ match: v, removed: null })
          }
        >
          <SelectTrigger className="h-9 w-28 shrink-0" aria-label="匹配状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部匹配</SelectItem>
            {MATCH_FILTER_OPTIONS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
            <SelectItem value={DOUBAN_REMOVED_FILTER}>
              {DOUBAN_REMOVED_LABEL}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={genre}
          onValueChange={(v) => apply({ genre: v })}
          // 关掉下拉就把展开状态收回，下次打开还是精简列表
          onOpenChange={(open) => {
            if (!open) setShowAllGenres(false);
          }}
        >
          <SelectTrigger className="h-9 w-32 shrink-0" aria-label="类型筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部类型</SelectItem>
            {visibleGenres.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {facetLabel(item)}
              </SelectItem>
            ))}
            {hasMoreGenres && !showAllGenres ? (
              <SelectItem
                value={SHOW_MORE_GENRES}
                className="text-muted-foreground"
                // 与「更多国家」同一套：它只是展开开关，不承担选中，
                // 先拦掉提交选中并关下拉的默认行为，下拉就留在原地铺开
                onPointerUp={(event) => {
                  if (event.pointerType === "mouse") {
                    event.preventDefault();
                    setShowAllGenres(true);
                  }
                }}
                onClick={(event) => {
                  event.preventDefault();
                  setShowAllGenres(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setShowAllGenres(true);
                  }
                }}
              >
                {`更多类型 (${genres.length - visibleGenres.length})…`}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>

        <Select
          value={country}
          onValueChange={(v) => apply({ country: v })}
          // 关掉下拉就把展开状态收回，下次打开还是精简列表
          onOpenChange={(open) => {
            if (!open) setShowAllCountries(false);
          }}
        >
          <SelectTrigger className="h-9 w-32 shrink-0" aria-label="国家筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部国家</SelectItem>
            {visibleCountries.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {facetLabel(item)}
              </SelectItem>
            ))}
            {hasMoreCountries && !showAllCountries ? (
              <SelectItem
                value={SHOW_MORE_COUNTRIES}
                className="text-muted-foreground"
                // 它只是个展开开关，不承担选中：Radix 在鼠标 pointerup / 触屏 click /
                // 键盘 Enter 里才提交选中并关下拉，这里先拦掉默认行为，下拉就留在原地铺开
                onPointerUp={(event) => {
                  if (event.pointerType === "mouse") {
                    event.preventDefault();
                    setShowAllCountries(true);
                  }
                }}
                onClick={(event) => {
                  event.preventDefault();
                  setShowAllCountries(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setShowAllCountries(true);
                  }
                }}
              >
                {`更多国家 (${countries.length - visibleCountries.length})…`}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>

        <ChannelFilter
          channels={channels}
          value={channel}
          onChange={(v) => apply({ channel: v })}
        />

        <Select value={sort} onValueChange={(v) => apply({ sort: v })}>
          <SelectTrigger className="h-9 w-32 shrink-0" aria-label="排序方式">
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
            className="h-9 shrink-0"
            disabled={pending}
            onClick={() => startTransition(() => router.replace("/library"))}
          >
            重置
          </Button>
        ) : null}
      </div>
    </div>
  );
}
