import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CirclePause, CirclePlay, Star, type LucideIcon } from "lucide-react";
import { NextEpisodeButton } from "@/components/library/next-episode-button";
import { WatchingStatusMenu } from "@/components/library/watching-status-menu";
import { RatingStars, WorkPoster } from "@/components/library/work-card";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, viewStatusTone, type ViewStatus } from "@/lib/labels";
import { listWorks, type WorkListItem } from "@/lib/queries";
import {
  nextEpisodeTarget,
  showProgressLabel,
  type SeasonStats,
  type ShowProgress,
} from "@/lib/watch-progress";

export const metadata: Metadata = { title: "追剧" };

/**
 * 三个标签页。搁置与弃看只由本地设置——豆瓣同步只会产出想看/在看/看过，
 * 所以这两页的内容多少完全取决于用户有没有主动去标。
 */
type WatchingTab = "watching" | "on_hold" | "dropped";

const TABS: { value: WatchingTab; label: string; icon: LucideIcon }[] = [
  { value: "watching", label: "在看", icon: CirclePlay },
  { value: "on_hold", label: "搁置", icon: CirclePause },
  { value: "dropped", label: "弃看", icon: Ban },
];

/** 一定带进度：数组已经滤过 null，类型上直接收窄，省去渲染处的判空 */
type WatchingItem = WorkListItem & { progress: ShowProgress };

/** 标签页的 URL。在看是默认页，不带参数，保持原有链接可用 */
function tabHref(tab: WatchingTab): string {
  return tab === "watching" ? "/watching" : `/watching?tab=${tab}`;
}

/** 从 URL 里取标签页，认不出的值一律回到「在看」 */
function resolveTab(value: string | string[] | undefined): WatchingTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return TABS.some((tab) => tab.value === raw) ? (raw as WatchingTab) : "watching";
}

/**
 * 找当前正追的那一季，用来展示季名与该季评分
 */
function currentSeason(progress: ShowProgress): SeasonStats | null {
  if (progress.currentSeason == null) return null;
  return (
    progress.seasons.find((s) => s.seasonNumber === progress.currentSeason) ?? null
  );
}

/**
 * 把一部剧归到哪个标签页。
 *
 * 搁置与弃看是用户明确的决定，优先于进度判断——哪怕这部剧早就标满了集数，
 * 只要用户说弃看，它就该待在弃看页，而不是被「已看完」悄悄吞掉。
 *
 * 剩下去看那一页的判定只认两件事：整剧没看完，且已经动过——要么标过至少一集，
 * 要么豆瓣侧是在看。一集都没标的「在看」也留在列表里，否则刚把一部剧标成在看，
 * 它会立刻从这一页消失，用户反而找不到地方记第一集。
 */
function bucketOf(item: WorkListItem): WatchingTab | null {
  if (item.latestStatus === "dropped") return "dropped";
  if (item.latestStatus === "on_hold") return "on_hold";

  const progress = item.progress;
  if (!progress || progress.completed) return null;
  if (progress.watchedCount === 0 && item.latestStatus !== "watching") return null;
  return "watching";
}

/** 按状态分好组的三份列表，顺序在组内排 */
function collectGroups(): Record<WatchingTab, WatchingItem[]> {
  const groups: Record<WatchingTab, WatchingItem[]> = {
    watching: [],
    on_hold: [],
    dropped: [],
  };

  for (const item of listWorks({ mediaType: "tv" })) {
    const progress = item.progress;
    if (!progress) continue;
    const bucket = bucketOf(item);
    if (!bucket) continue;
    groups[bucket].push({ ...item, progress });
  }

  // 先按逐集记录的最近标记日排，再退回豆瓣流水的观看日：
  // 逐集标记是当场点出来的，比几周没同步的豆瓣时间更贴近「最近追到哪」
  for (const list of Object.values(groups)) {
    list.sort((a, b) => {
      const left = a.lastEpisodeAt ?? a.lastWatchedAt ?? "";
      const right = b.lastEpisodeAt ?? b.lastWatchedAt ?? "";
      if (left !== right) return left < right ? 1 : -1;
      return b.id - a.id;
    });
  }

  return groups;
}

function WatchingCard({
  item,
  tab,
}: {
  item: WatchingItem;
  /** 当前所在标签页。只有在看页才给「标记下一集」——搁置的剧不该顺手推进进度 */
  tab: WatchingTab;
}) {
  const { progress } = item;
  const season = currentSeason(progress);
  const nextEpisode = nextEpisodeTarget(progress);
  const label = showProgressLabel(progress);
  const total = progress.totalCount;
  const percent = total > 0 ? (progress.watchedCount / total) * 100 : 0;
  // 该季评分比最近一条流水的评分更贴题：豆瓣按季建条目，最近一条可能是别的季
  const rating = season?.rating ?? item.latestRating;
  const lastAt = item.lastEpisodeAt ?? item.lastWatchedAt;
  const status = item.latestStatus;

  return (
    <li className="flex gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <Link
        href={`/library/${item.id}`}
        aria-label={`打开《${item.title}》详情`}
        className="w-16 shrink-0 self-start overflow-hidden rounded-lg ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-20"
      >
        <WorkPoster
          title={item.title}
          posterPath={item.posterPath}
          status={status}
        />
      </Link>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/library/${item.id}`}
            className="line-clamp-1 text-sm font-medium outline-none hover:underline focus-visible:underline"
            title={item.title}
          >
            {item.title}
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {rating ? <RatingStars value={rating} /> : null}
            {item.latestRecordId != null && status ? (
              <WatchingStatusMenu
                recordId={item.latestRecordId}
                status={status as ViewStatus}
                label={item.title}
              />
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {status ? (
            <span
              className={`inline-flex h-5 items-center rounded-4xl px-2 font-medium ${viewStatusTone(status)}`}
            >
              {TABS.find((t) => t.value === status)?.label ?? status}
            </span>
          ) : null}
          {season ? <span className="text-muted-foreground">{season.name}</span> : null}
          {season?.voteAverage ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Star className="size-3 fill-primary text-primary" />
              TMDB {season.voteAverage.toFixed(1)}
            </span>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {label ?? "还没有标记集数"}
        </p>

        {total > 0 ? <Progress value={percent} /> : null}

        {/* 标记下一集的入口放在卡片里，追剧时不必每次进详情页开面板。
            要挑日期、跳集或整季补齐，仍走详情页的分季面板。 */}
        {tab === "watching" && nextEpisode ? (
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {lastAt ? `最近标记 ${formatDate(lastAt)}` : nextEpisode.seasonName}
            </span>
            <NextEpisodeButton
              workId={item.id}
              seasonNumber={nextEpisode.seasonNumber}
              episodeNumber={nextEpisode.episodeNumber}
              completesSeason={nextEpisode.completesSeason}
              nextSeasonName={nextEpisode.nextSeasonName}
              label={item.title}
            />
          </div>
        ) : lastAt ? (
          <p className="text-xs text-muted-foreground">
            最近标记 {formatDate(lastAt)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** 每个标签页的空态文案。「在看」为空是常态，另外两页得说清怎么把剧放进来 */
const EMPTY_STATES: Record<
  WatchingTab,
  { title: string; description: string; withAction: boolean }
> = {
  watching: {
    title: "还没有在追的剧",
    description: "在档案库里打开一部剧集，标记几集进度后，它就会出现在这里。",
    withAction: true,
  },
  on_hold: {
    title: "没有搁置的剧",
    description:
      "暂时不想追、打算以后再说的剧，可以在在看列表里点卡片右上角的菜单搁到这儿。",
    withAction: false,
  },
  dropped: {
    title: "没有弃看的剧",
    description:
      "不打算追完的剧可以移到这儿。已标记的集数与日期都会保留，想接着追随时可以恢复。",
    withAction: false,
  },
};

export default async function WatchingPage({ searchParams }: PageProps<"/watching">) {
  const params = await searchParams;
  const tab = resolveTab(params.tab);
  const groups = collectGroups();
  const items = groups[tab];
  const meta = TABS.find((t) => t.value === tab) ?? TABS[0];
  const empty = EMPTY_STATES[tab];

  return (
    <>
      <PageHeader
        title="追剧"
        description="正在追、暂时搁置和已经弃看的剧集。点一下即可推进到下一集。"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href={`/library?type=tv&status=${tab}`}>在档案库筛选</Link>
        </Button>
      </PageHeader>

      <Tabs value={tab} className="gap-4">
        <TabsList className="w-full">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} asChild>
              <Link href={tabHref(value)}>
                <Icon />
                {label}
                <span className="text-xs tabular-nums opacity-70">
                  {groups[value].length}
                </span>
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* 只渲染当前页：另外两组已经算好但没必要发到浏览器 */}
        <TabsContent value={tab}>
          {items.length === 0 ? (
            <EmptyState
              icon={meta.icon}
              title={empty.title}
              description={empty.description}
            >
              {empty.withAction ? (
                <Button size="sm" asChild>
                  <Link href="/library?type=tv">去档案库挑剧</Link>
                </Button>
              ) : null}
            </EmptyState>
          ) : (
            <>
              <p className="mb-4 text-xs text-muted-foreground">
                共 {items.length} 部{meta.label}
              </p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <WatchingCard key={item.id} item={item} tab={tab} />
                ))}
              </ul>
            </>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
