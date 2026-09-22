import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clapperboard, Film, Layers, Repeat } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SyncCards } from "@/components/overview/sync-cards";
import { WorkPoster } from "@/components/library/work-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DOUBAN_REMOVED_FILTER, viewStatusLabel, viewStatusTone } from "@/lib/labels";
import { getOverviewStats, listRecentWatches } from "@/lib/queries";
import { getSetting } from "@/lib/settings";
import { getSyncCardsState } from "@/lib/sync-status-server";

export const metadata: Metadata = { title: "概览" };

export default function OverviewPage() {
  const stats = getOverviewStats();
  const recent = listRecentWatches(8);
  const syncState = getSyncCardsState();

  // 豆瓣「看过」列表自己声明的条数。它只用来解释差额，不参与任何统计——
  // 豆瓣把它删除或合并掉的条目仍计入总数，但列表接口不再返回，所以本地永远少这几条。
  const declaredWatched = getSetting("douban.lastWatchedTotal");
  const watchedGap = declaredWatched - stats.watchedRecordCount;

  // 「2018-11-04」→「2018-11」，只到月份就够说明跨度了
  const since = stats.firstWatchedAt ? stats.firstWatchedAt.slice(0, 7) : null;

  const cards = [
    {
      key: "works",
      label: "作品总数",
      icon: Layers,
      hint: `电影 ${stats.movieCount} · 剧集 ${stats.tvCount}`,
      value: String(stats.workCount),
    },
    {
      key: "watched",
      label: "看过",
      icon: Film,
      hint: "同豆瓣「已看」，如有差额可能存在删/并/私密",
      value: String(stats.watchedRecordCount),
    },
    {
      key: "rewatch",
      label: "N刷",
      icon: Repeat,
      hint: "看过 2 遍及以上的作品，按作品去重",
      value: String(stats.rewatchWorkCount),
    },
    {
      key: "days",
      label: "观影天数",
      icon: CalendarDays,
      hint: since ? `${since} 至今，同一天看多部只算一天` : "有看过日期的天数",
      value: String(stats.watchDays),
    },
    {
      key: "this-year",
      label: "今年看过",
      icon: Clapperboard,
      hint: `去年全年 ${stats.lastYearCount} 条`,
      value: String(stats.thisYearCount),
    },
  ];

  return (
    <>
      <PageHeader
        title="概览"
        description="你的观影轨迹一览。"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.key} className="gap-0">
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {card.label}
                  </span>
                  <Icon className="size-4 text-primary/70" />
                </div>
                <div className="text-3xl font-semibold tracking-tight">
                  {card.value}
                </div>
                <p className="text-xs text-muted-foreground">{card.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">同步</h2>
          <p className="text-xs text-muted-foreground">
            worker 每 2 小时增量、每周全量。倒计时是预估时刻，实际执行会前后浮动
            ±25%（2 小时轮约 ±30 分钟）
          </p>
        </div>
        <SyncCards initial={syncState} />

        {/* 差额为 0（或还没抓到豆瓣的声明数）时不显示：没有差异就没有解释的必要。
            出现差额基本只有一个原因——豆瓣把条目删除、合并或转为私密后，它们仍计入
            总数，但列表接口不再返回，所以本地抓不到，与同步是否跑完无关。 */}
        {watchedGap > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            豆瓣「已看」声明 {declaredWatched} 条 · 本地已抓{" "}
            {stats.watchedRecordCount} 条 · 差 {watchedGap} 条 ｜ 差额来自豆瓣已删除、
            合并或转为私密的条目，它们仍计入豆瓣总数但不再出现在列表里，无法抓取
          </p>
        ) : null}
        {/* 有标记才提示：没标记说明同步没发现任何条目从豆瓣列表上消失。
            豆瓣把它删除、合并或转为私密后，本地流水照旧保留，只是打上标记，
            清不清理交给用户自己决定，所以这里只给条数与入口，不做任何自动删除。 */}
        {stats.doubanRemovedCount > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            有 {stats.doubanRemovedCount} 条记录在最近一次同步中已不在豆瓣列表上 ｜{" "}
            <Link
              href={`/library?removed=${DOUBAN_REMOVED_FILTER}`}
              className="text-primary hover:underline"
            >
              去档案库查看
            </Link>
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">最近观看</h2>
          {recent.length > 0 ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/library">全部作品</Link>
            </Button>
          ) : null}
        </div>

        {recent.length === 0 ? (
          <EmptyState
            icon={Film}
            title="还没有观影记录"
            description="在档案库里添加作品并记一次观看，这里就会显示最近的观影流水。"
          >
            <Button size="sm" asChild>
              <Link href="/library">去档案库</Link>
            </Button>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {recent.map(({ record, work: item }) => (
              <li key={record.id} className="flex items-center gap-3 px-3 py-3">
                <div className="w-9 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10">
                  <WorkPoster
                    title={item?.title ?? "未知作品"}
                    posterPath={item?.posterPath ?? null}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  {item ? (
                    <Link
                      href={`/library/${item.id}`}
                      className="line-clamp-1 text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <p className="line-clamp-1 text-sm font-medium text-muted-foreground">
                      未关联作品
                    </p>
                  )}
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={`inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium ${viewStatusTone(record.status)}`}
                    >
                      {viewStatusLabel(record.status)}
                    </span>
                    {record.rating ? <span>{record.rating} 星</span> : null}
                    <span>{record.watchedAt ?? "未填写日期"}</span>
                  </p>
                </div>

                {record.watchIndex > 1 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {record.watchIndex} 刷
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
