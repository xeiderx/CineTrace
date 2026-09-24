import type { Metadata } from "next";
import Link from "next/link";
import { Film, Library as LibraryIcon } from "lucide-react";
import { deleteWorkInListAction } from "@/app/actions/library";
import { ChannelIcon } from "@/components/library/channel-icon";
import { ConfirmDeleteButton } from "@/components/library/confirm-delete-button";
import { LibraryFilters } from "@/components/library/library-filters";
import { LibraryPagination } from "@/components/library/library-pagination";
import { LibraryScrollMemory } from "@/components/library/library-scroll-memory";
import { WorkSearchCreateDialog } from "@/components/library/work-search-create-dialog";
import {
  RatingStars,
  WorkMediaTypeIcon,
  WorkMetaBadges,
  WorkPoster,
} from "@/components/library/work-card";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate, tagChipStyle } from "@/lib/labels";
import {
  listCountryFacets,
  listGenreFacets,
  listSourceChannels,
  listWorksPage,
  type WorkFilters,
} from "@/lib/queries";
import { libraryProgressLabel } from "@/lib/watch-progress";

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
    channel: pick("channel") ?? undefined,
    removed: pick("removed") ?? undefined,
    sort: (pick("sort") as WorkFilters["sort"]) ?? "recent",
  };

  // 手改 URL 可能带来非法页码，交给 listWorksPage 收敛到有效范围
  const requestedPage = Number.parseInt(pick("page") ?? "", 10);
  const result = listWorksPage(
    filters,
    Number.isNaN(requestedPage) ? 1 : requestedPage,
  );
  const hasAnyFilter = Boolean(
    filters.q ||
      filters.mediaType ||
      filters.status ||
      filters.matchStatus ||
      filters.country ||
      filters.genre ||
      filters.channel ||
      filters.removed,
  );

  // 只在「全部」或「看过」这两种筛选下并列流水数：其余筛选（想看/在看）与「已看流水」
  // 不是同一批条目，同一个作品也可能带着旧的看过记录，并列出来只会让人算不明白。
  const showRecordTotal =
    (filters.status === undefined || filters.status === "watched") &&
    result.recordTotal > result.total;

  // 国家与类型下拉的候选项来自全库分布，不随当前筛选收窄，
  // 免得筛完一项后其它选项消失、反而不好改条件
  const countries = listCountryFacets();
  const genres = listGenreFacets();
  const channels = listSourceChannels();

  return (
    <>
      <LibraryScrollMemory />

      <PageHeader
        title="档案库"
        description="所有作品与观影流水。一部作品反复观看会保留多刷记录。"
      >
        <WorkSearchCreateDialog />
      </PageHeader>

      <LibraryFilters
        countries={countries}
        genres={genres}
        channels={channels}
      />

      {result.total === 0 ? (
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
            共 {result.total} 部作品
            {showRecordTotal
              ? ` · ${result.recordTotal} 条看过记录（同剧多季各算一条）`
              : null}
            {result.pageCount > 1
              ? ` · 第 ${result.page} / ${result.pageCount} 页`
              : null}
          </p>
          {/* 栅格列数与 LIBRARY_PAGE_SIZE 联动：20 在 2/4/5 列下都排得满，
              所以这里不设 3 列档——多一档就会在末行留出空位 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-5">
            {result.items.map((item) => {
              // 进度文案只报位置（「至 S1E04」/「共 3 季 · 25 集」）；
              // 状态另有元信息行的单字徽标表达，这里不再重复
              const progress = item.progress
                ? libraryProgressLabel(item.progress)
                : null;
              return (
                // 删除按钮与链接是兄弟节点而非嵌套：按钮放进 <Link> 内部时，
                // 点它会连带触发跳转，键盘与读屏也会把它当成链接的一部分。
                // 因此「进度 + 标签」这一块都放在链接之外。
                <div key={item.id} className="group relative flex flex-col gap-1.5">
                  <Link
                    href={`/library/${item.id}`}
                    className="block space-y-2.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="relative overflow-hidden rounded-lg ring-1 ring-foreground/10">
                      <WorkPoster
                        title={item.title}
                        posterPath={item.posterPath}
                        watchIndex={item.watchIndex}
                        // 刷次徽章挪到左上角，把右上角让给垃圾桶
                        watchBadgeCorner="left"
                      />
                      {/* 打分与来源渠道同处一条底部渐变栏，左右对齐 */}
                      {item.latestRating || item.latestChannel ? (
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                          {item.latestRating ? (
                            <RatingStars value={item.latestRating} />
                          ) : (
                            <span />
                          )}
                          {item.latestChannel ? (
                            <span
                              className="inline-flex shrink-0 items-center"
                              title={
                                item.latestChannel.label
                                  ? `来源渠道：${item.latestChannel.label}`
                                  : "来源渠道"
                              }
                            >
                              <ChannelIcon
                                icon={item.latestChannel.icon}
                                color={item.latestChannel.color}
                                size="lg"
                                className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
                              />
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      {/* 第一行：名称 + 年代 + 类型图标。片名可收缩截断但不撑满，
                          这样年代紧跟其后（约一个汉字的间距），类型图标靠右 */}
                      <div className="flex items-center gap-3">
                        <p
                          className="min-w-0 truncate text-sm font-medium"
                          title={item.title}
                        >
                          {item.title}
                        </p>
                        {item.year ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {item.year}
                          </span>
                        ) : null}
                        <WorkMediaTypeIcon
                          mediaType={item.mediaType}
                          className="ml-auto size-3.5 shrink-0 text-muted-foreground"
                        />
                      </div>
                      {/* 第二行：看过日期 + 单字状态（看/追/想/搁/弃）+ 进度（至 S1E04），
                          「豆瓣已移除」被挤到下一行。渠道图标已挪到海报右下角，这里不传 channel */}
                      <WorkMetaBadges
                        date={
                          item.lastWatchedAt ? formatDate(item.lastWatchedAt) : null
                        }
                        status={item.latestStatus}
                        compactStatus
                        statusSuffix={progress}
                        removedCount={item.removedCount}
                      />
                    </div>
                  </Link>

                  {/* 第三行：标签。字号比默认徽标小一号，一行大约排得下三个
                      四字标签；超出的一律折叠成 +N，点进详情页再看全部 */}
                  {item.tags.length > 0 ? (
                    <div className="flex items-center gap-1">
                      {item.tags.slice(0, 3).map((t) => (
                        <Badge
                          key={t.id}
                          variant="secondary"
                          className="h-4 max-w-[5rem] truncate px-1.5 py-0 text-[11px] font-normal"
                          style={tagChipStyle(t.color)}
                        >
                          {t.name}
                        </Badge>
                      ))}
                      {item.tags.length > 3 ? (
                        <span
                          className="shrink-0 text-[11px] text-muted-foreground"
                          title={item.tags
                            .slice(3)
                            .map((t) => t.name)
                            .join("、")}
                        >
                          +{item.tags.length - 3}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 桌面端悬停才现身，避免整屏卡片挂满垃圾桶；触屏没有 hover，
                      用 group-focus-within 让键盘也能到达，并始终保留可点区域。
                      底色用黑色半透明：海报明暗不一，半透明黑比纯色底更稳，也不抢眼 */}
                  <div className="absolute right-1.5 top-1.5 rounded-md bg-black/50 backdrop-blur transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-0">
                    <ConfirmDeleteButton
                      action={deleteWorkInListAction}
                      id={item.id}
                      title={`删除《${item.title}》？`}
                      description="作品及其全部观影记录都会被删除，此操作不可撤销。"
                      label={`删除《${item.title}》`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <LibraryPagination page={result.page} pageCount={result.pageCount} />
        </>
      )}
    </>
  );
}
