import type { Metadata } from "next";
import Link from "next/link";
import { CirclePlay, Star } from "lucide-react";
import { NextEpisodeButton } from "@/components/library/next-episode-button";
import { RatingStars, WorkPoster } from "@/components/library/work-card";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDate, viewStatusLabel, viewStatusTone } from "@/lib/labels";
import { listWorks, type WorkListItem } from "@/lib/queries";
import {
  nextEpisodeTarget,
  showProgressLabel,
  type SeasonStats,
  type ShowProgress,
} from "@/lib/watch-progress";

export const metadata: Metadata = { title: "追剧" };

/** 一定带进度：数组已经滤过 null，类型上直接收窄，省去渲染处的判空 */
type WatchingItem = WorkListItem & { progress: ShowProgress };

/** 找当前正追的那一季，用来展示季名与该季评分 */
function currentSeason(progress: ShowProgress): SeasonStats | null {
  if (progress.currentSeason == null) return null;
  return (
    progress.seasons.find((s) => s.seasonNumber === progress.currentSeason) ?? null
  );
}

/**
 * 追剧页的在看列表。
 *
 * 「在追」的判定只认两件事：整剧没看完，且已经动过——要么标过至少一集，
 * 要么豆瓣侧是在看。一集都没标的「在看」也留在列表里，否则刚把一部剧
 * 标成在看，它会立刻从这一页消失，用户反而找不到地方记第一集。
 */
function collectWatching(): WatchingItem[] {
  const items: WatchingItem[] = [];

  for (const item of listWorks({ mediaType: "tv" })) {
    const progress = item.progress;
    if (!progress || progress.completed) continue;
    if (progress.watchedCount === 0 && item.latestStatus !== "watching") continue;
    items.push({ ...item, progress });
  }

  // 先按逐集记录的最近标记日排，再退回豆瓣流水的观看日：
  // 逐集标记是当场点出来的，比几周没同步的豆瓣时间更贴近「最近追到哪」
  return items.sort((a, b) => {
    const left = a.lastEpisodeAt ?? a.lastWatchedAt ?? "";
    const right = b.lastEpisodeAt ?? b.lastWatchedAt ?? "";
    if (left !== right) return left < right ? 1 : -1;
    return b.id - a.id;
  });
}

function WatchingCard({ item }: { item: WatchingItem }) {
  const { progress } = item;
  const season = currentSeason(progress);
  const nextEpisode = nextEpisodeTarget(progress);
  const label = showProgressLabel(progress);
  const total = progress.totalCount;
  const percent = total > 0 ? (progress.watchedCount / total) * 100 : 0;
  // 该季评分比最近一条流水的评分更贴题：豆瓣按季建条目，最近一条可能是别的季
  const rating = season?.rating ?? item.latestRating;
  const lastAt = item.lastEpisodeAt ?? item.lastWatchedAt;

  return (
    <li className="flex gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <Link
        href={`/library/${item.id}`}
        aria-label={`打开《${item.title}》详情`}
        className="w-16 shrink-0 self-start overflow-hidden rounded-lg ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-20"
      >
        <WorkPoster title={item.title} posterPath={item.posterPath} />
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
          {rating ? <RatingStars value={rating} /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {item.latestStatus ? (
            <span
              className={`inline-flex h-5 items-center rounded-4xl px-2 font-medium ${viewStatusTone(item.latestStatus)}`}
            >
              {viewStatusLabel(item.latestStatus)}
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
        {nextEpisode ? (
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

export default function WatchingPage() {
  const items = collectWatching();

  return (
    <>
      <PageHeader
        title="追剧"
        description="正在追的剧集与逐集进度。点一下即可推进到下一集。"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/library?type=tv&status=watching">在档案库筛选</Link>
        </Button>
      </PageHeader>

      {items.length === 0 ? (
        <EmptyState
          icon={CirclePlay}
          title="还没有在追的剧"
          description="在档案库里打开一部剧集，标记几集进度后，它就会出现在这里。"
        >
          <Button size="sm" asChild>
            <Link href="/library?type=tv">去档案库挑剧</Link>
          </Button>
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            共 {items.length} 部在追
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <WatchingCard key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
