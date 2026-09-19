import type { Metadata } from "next";
import Link from "next/link";
import { Film, Library as LibraryIcon } from "lucide-react";
import { LibraryFilters } from "@/components/library/library-filters";
import { WorkSearchCreateDialog } from "@/components/library/work-search-create-dialog";
import {
  RatingStars,
  WorkMetaBadges,
  WorkPoster,
  progressLabel,
} from "@/components/library/work-card";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate, parseStringList } from "@/lib/labels";
import {
  listCountryFacets,
  listGenreFacets,
  listWorks,
  type WorkFilters,
} from "@/lib/queries";

export const metadata: Metadata = { title: "档案库" };

export default async function LibraryPage({
  searchParams,
}: PageProps<"/library">) {
  const params = await searchParams;

  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters: WorkFilters = {
    q: pick("q") ?? undefined,
    mediaType: pick("type") ?? undefined,
    status: pick("status") ?? undefined,
    matchStatus: pick("match") ?? undefined,
    country: pick("country") ?? undefined,
    genre: pick("genre") ?? undefined,
    sort: (pick("sort") as WorkFilters["sort"]) ?? "recent",
  };

  const items = listWorks(filters);
  const hasAnyFilter = Boolean(
    filters.q ||
      filters.mediaType ||
      filters.status ||
      filters.matchStatus ||
      filters.country ||
      filters.genre,
  );

  // 国家与类型下拉的候选项来自全库分布，不随当前筛选收窄，
  // 免得筛完一项后其它选项消失、反而不好改条件
  const countries = listCountryFacets();
  const genres = listGenreFacets();

  return (
    <>
      <PageHeader
        title="档案库"
        description="所有作品与观影流水。一部作品反复观看会保留多刷记录。"
      >
        <WorkSearchCreateDialog />
      </PageHeader>

      <LibraryFilters countries={countries} genres={genres} />

      {items.length === 0 ? (
        <EmptyState
          icon={hasAnyFilter ? Film : LibraryIcon}
          title={hasAnyFilter ? "没有符合条件的作品" : "档案库为空"}
          description={
            hasAnyFilter
              ? "换个关键词或放宽筛选条件试试。"
              : "可以先用「手动添加」录入作品，之后接入豆瓣同步与 TMDB 匹配会自动填充。"
          }
        >
          {hasAnyFilter ? null : <WorkSearchCreateDialog />}
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            共 {items.length} 部作品
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => {
              const progress = progressLabel({
                mediaType: item.mediaType,
                progressSeason: item.progressSeason,
                progressEpisode: item.progressEpisode,
                episodesWatched: item.episodesWatched,
              });
              return (
                <Link
                  key={item.id}
                  href={`/library/${item.id}`}
                  className="group space-y-2.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="relative overflow-hidden rounded-lg ring-1 ring-foreground/10">
                    <WorkPoster title={item.title} posterPath={item.posterPath} />
                    {item.latestRating ? (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                        <RatingStars value={item.latestRating} />
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <p className="line-clamp-1 text-sm font-medium" title={item.title}>
                      {item.title}
                    </p>
                    <WorkMetaBadges
                      mediaType={item.mediaType}
                      year={item.year}
                      status={item.latestStatus}
                      watchCount={item.watchCount}
                      country={parseStringList(item.countries)[0] ?? null}
                    />
                    {progress ? (
                      <p className="text-xs text-muted-foreground">{progress}</p>
                    ) : item.lastWatchedAt ? (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(item.lastWatchedAt)}
                      </p>
                    ) : null}
                    {item.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {item.tags.slice(0, 3).map((t) => (
                          <Badge key={t.id} variant="secondary" className="font-normal">
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
