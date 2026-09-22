import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, Film, ListChecks, Star, Tv } from "lucide-react";
import {
  deleteViewRecordAction,
  deleteWorkAction,
} from "@/app/actions/library";
import { ConfirmDeleteButton } from "@/components/library/confirm-delete-button";
import { CastWall, type CastPortrait } from "@/components/library/cast-wall";
import {
  SeasonProgressPanel,
  type PanelSeason,
} from "@/components/library/season-progress-panel";
import { ViewRecordDialog } from "@/components/library/view-record-dialog";
import { WorkFormDialog } from "@/components/library/work-form-dialog";
import { WorkMatchDialog } from "@/components/library/work-match-dialog";
import { WorkTagEditor } from "@/components/library/work-tag-editor";
import {
  RatingStars,
  WorkMetaBadges,
  WorkPoster,
  progressLabel,
} from "@/components/library/work-card";
import { EmptyState } from "@/components/layout/empty-state";
import { BackButton } from "@/components/layout/back-button";
import { Progress } from "@/components/ui/progress";
import {
  DOUBAN_REMOVED_LABEL,
  formatDate,
  formatDateRange,
  formatMinutes,
  matchStatusLabel,
  mediaTypeLabel,
  parseCast,
  parseStringList,
  viewStatusLabel,
  viewStatusTone,
} from "@/lib/labels";
import {
  getDefaultPlatform,
  getWorkDetail,
  latestRecord,
  listPlatforms,
  listTags,
  posterUrl,
  type SeasonWithRecord,
  type ViewRecordWithPlatform,
} from "@/lib/queries";
import { dateSourceHint, showProgressLabel, todayIso } from "@/lib/watch-progress";
import type { Platform, Tag } from "@/db/schema";

export async function generateMetadata({
  params,
}: PageProps<"/library/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = getWorkDetail(Number(id));
  return { title: detail?.work.title ?? "作品详情" };
}

/** 元信息的一行：标签 + 值，值为空则整行不渲染 */
function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}

/** 观影平台小标签：平台自身颜色优先，未指定平台时标注「默认」 */
function PlatformChip({ record }: { record: ViewRecordWithPlatform }) {
  if (!record.platformName) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-4xl bg-muted px-2 py-0.5 text-xs">
      {record.platformColor ? (
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ backgroundColor: record.platformColor }}
        />
      ) : null}
      {record.platformName}
      {record.isDefaultPlatform ? (
        <span className="text-muted-foreground">（默认）</span>
      ) : null}
    </span>
  );
}

/** 单条观影流水的展示：状态、评分、时间、平台、剧集进度与短评 */
function ViewRecordItem({
  record,
  mediaType,
  platforms,
  defaultPlatformName,
  seasons,
  tags,
  allTags,
}: {
  record: ViewRecordWithPlatform;
  mediaType: string;
  platforms: Platform[];
  defaultPlatformName: string | null;
  seasons: SeasonWithRecord[];
  /** 作品已挂标签与全部标签，透传给弹窗里的标签选择区 */
  tags: Tag[];
  allTags: Tag[];
}) {
  const progress = progressLabel({
    mediaType,
    progressSeason: record.progressSeason,
    progressEpisode: record.progressEpisode,
    episodesWatched: record.episodesWatched,
  });
  const range = formatDateRange(record.startedAt, record.finishedAt);

  return (
    <li className="flex gap-3 px-4 py-4">
      <div className="flex flex-col items-center gap-1">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
          title={`第 ${record.watchIndex} 刷`}
        >
          {record.watchIndex}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium ${viewStatusTone(record.status)}`}
          >
            {viewStatusLabel(record.status)}
          </span>
          <RatingStars value={record.rating} />
          <span className="text-xs text-muted-foreground">
            {record.watchedAt
              ? `标记于 ${record.watchedAt}`
              : record.startedAt
                ? `开始于 ${record.startedAt}`
                : "未填写日期"}
          </span>
          <PlatformChip record={record} />
          {/* 豆瓣把它删掉/合并/转私密后本地仍留着这条流水，只是打上时间戳。
              清理与否由用户决定，因此只提示、不自动删。 */}
          {record.doubanRemovedAt ? (
            <span
              className="inline-flex h-5 items-center rounded-4xl bg-amber-500/15 px-2 text-xs font-medium text-amber-400"
              title="最后一次全量同步时，这条记录已不在豆瓣列表上"
            >
              {DOUBAN_REMOVED_LABEL}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {range ? <span>观看 {range}</span> : null}
          {progress ? <span>{progress}</span> : null}
        </div>

        {record.comment ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/90">
            {record.comment}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-start gap-1">
        <ViewRecordDialog
          workId={record.workId ?? 0}
          mediaType={mediaType}
          platforms={platforms}
          defaultPlatformName={defaultPlatformName}
          seasons={seasons}
          record={record}
          tags={tags}
          allTags={allTags}
        />
        <ConfirmDeleteButton
          action={deleteViewRecordAction}
          id={record.id}
          title={`删除第 ${record.watchIndex} 刷记录？`}
          description="这条观影流水会被永久删除，作品本身不受影响。"
        />
      </div>
    </li>
  );
}

/** 日期 + 来源后缀，来源是「手动」时高亮，提示它不会被豆瓣覆盖 */
function SeasonDate({
  label,
  date,
}: {
  label: string;
  date: { value: string | null; source: "manual" | "episode" | "douban" | null };
}) {
  const hint = dateSourceHint(date.source);
  return (
    <span>
      {label} {formatDate(date.value)}
      {date.value && hint ? (
        <span className={date.source === "manual" ? "text-primary" : undefined}>
          （{hint}）
        </span>
      ) : null}
    </span>
  );
}

/**
 * 分季卡片：TMDB 的季结构 + 该季的逐集进度、起止时间与评分。
 * 整块即按钮，点开逐集进度面板——移动端不必瞄准小图标。
 */
function SeasonItem({
  season,
  workId,
  seasons,
  today,
}: {
  season: SeasonWithRecord;
  workId: number;
  /** 面板里的季切换要用全部季，所以整份传下去 */
  seasons: PanelSeason[];
  today: string;
}) {
  const poster = posterUrl(season.posterPath, "w185");
  const { record } = season;
  const total = season.episodeCount;

  return (
    <li>
      <SeasonProgressPanel
        workId={workId}
        seasons={seasons}
        initialSeason={season.seasonNumber}
        today={today}
        trigger={
          <button
            type="button"
            aria-label={`标记《${season.name}》的观看进度`}
            className="flex w-full cursor-pointer gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
          >
            <div className="w-16 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt={`${season.name} 海报`}
                  loading="lazy"
                  className="aspect-[2/3] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center text-lg font-semibold text-muted-foreground/50">
                  {season.seasonNumber}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{season.name}</span>
                {season.completed ? (
                  <span className="inline-flex h-5 items-center rounded-4xl bg-primary/15 px-2 text-xs font-medium text-primary">
                    {season.completionSource === "douban" ? "豆瓣已看完" : "已看完"}
                  </span>
                ) : season.watchedCount > 0 ? (
                  <span className="inline-flex h-5 items-center rounded-4xl bg-muted px-2 text-xs font-medium text-muted-foreground">
                    追剧中
                  </span>
                ) : null}
                {season.voteAverage ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Star className="size-3 fill-primary text-primary" />
                    TMDB {season.voteAverage.toFixed(1)}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {total > 0 ? (
                  <span>
                    已看 {season.watchedCount}/{total} 集
                  </span>
                ) : (
                  <span>已看 {season.watchedCount} 集</span>
                )}
                {season.airDate ? <span>{season.airDate} 首播</span> : null}
              </div>

              {total > 0 ? (
                <Progress value={(season.watchedCount / total) * 100} />
              ) : null}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <SeasonDate label="开始" date={season.startedAt} />
                <SeasonDate label="看完" date={season.finishedAt} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  {record ? (
                    <>
                      <RatingStars value={record.rating} />
                      <span className="text-muted-foreground">
                        {record.watchedAt
                          ? `${record.watchedAt} 标记`
                          : "未填写标记日期"}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">豆瓣无这一季的标记</span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  <ListChecks className="size-3.5" />
                  标记进度
                </span>
              </div>
            </div>
          </button>
        }
      />
    </li>
  );
}

export default async function WorkDetailPage({
  params,
}: PageProps<"/library/[id]">) {
  const { id } = await params;
  const detail = getWorkDetail(Number(id));
  if (!detail) notFound();

  const { work: item, records, tags, seasons, progress } = detail;
  const platforms = listPlatforms();
  const defaultPlatform = getDefaultPlatform();
  const allTags = listTags();
  const isTv = item.mediaType === "tv";

  const latest = latestRecord(records);
  // 刷次取下流水的最大 watchIndex，不能数流水条数：
  // 豆瓣按季建条目，多季剧一季一条流水，按条数算会把季数当刷数（7 季剧显示成 7 刷）
  const watchIndex = records.reduce((max, r) => Math.max(max, r.watchIndex), 1);
  // 整剧进度优先看逐集数据：它比 progressSeason/episodesWatched 这类手填列准
  const progressText = progress ? showProgressLabel(progress) : null;
  // 面板里的季切换、日期默认值都在客户端用，这里把服务端数据裁成纯值再下传
  const today = todayIso();
  const panelSeasons: PanelSeason[] = seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    name: season.name,
    episodeCount: season.episodeCount,
    watchedEpisodes: season.watchedEpisodes,
    completed: season.completed,
    completionSource: season.completionSource,
  }));

  const genres = parseStringList(item.genres);
  const countries = parseStringList(item.countries);
  const directors = parseStringList(item.directors);
  const cast = parseCast(item.cast);

  // 头像地址在这里拼好：客户端组件不引入连着数据库的 queries 模块
  const castPortraits: CastPortrait[] = cast
    .filter((c): c is typeof c & { id: number } => c.id !== null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profileUrl: posterUrl(c.profilePath, "w185"),
    }));

  const externalIds = [
    item.tmdbId ? `TMDB ${item.tmdbId}` : null,
    item.doubanId ? `豆瓣 ${item.doubanId}` : null,
    item.imdbId ? `IMDb ${item.imdbId}` : null,
  ].filter(Boolean);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <BackButton />

        <div className="flex items-center gap-2">
          <ViewRecordDialog
            workId={item.id}
            mediaType={item.mediaType}
            platforms={platforms}
            defaultPlatformName={defaultPlatform?.name ?? null}
            seasons={seasons}
            tags={tags}
            allTags={allTags}
          />
          <WorkMatchDialog workId={item.id} workTitle={item.title} />
          <WorkFormDialog work={item} tags={tags} allTags={allTags} />
          <ConfirmDeleteButton
            action={deleteWorkAction}
            id={item.id}
            title={`删除《${item.title}》？`}
            description="作品及其全部观影记录都会被删除，此操作不可撤销。"
            label="删除作品"
            iconOnly={false}
          />
        </div>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="w-36 shrink-0 sm:w-48">
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <WorkPoster
              title={item.title}
              posterPath={item.posterPath}
              watchIndex={watchIndex}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {item.title}
            </h1>
            {item.originalTitle && item.originalTitle !== item.title ? (
              <p className="text-sm text-muted-foreground">{item.originalTitle}</p>
            ) : null}
            <WorkMetaBadges
              mediaType={item.mediaType}
              year={item.year}
              status={latest?.status ?? null}
              country={countries[0] ?? null}
              removedCount={records.filter((r) => r.doubanRemovedAt != null).length}
            />
          </div>

          <WorkTagEditor
            workId={item.id}
            attached={tags}
            allTags={allTags}
          />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              {isTv ? <Tv className="size-3.5" /> : <Film className="size-3.5" />}
              {mediaTypeLabel(item.mediaType)}
            </span>
            {item.runtime ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {isTv ? `单集 ${item.runtime} 分钟` : formatMinutes(item.runtime)}
              </span>
            ) : null}
            {item.seasonCount || item.episodeCount ? (
              <span>
                {item.seasonCount ? `${item.seasonCount} 季` : ""}
                {item.seasonCount && item.episodeCount ? " · " : ""}
                {item.episodeCount ? `${item.episodeCount} 集` : ""}
              </span>
            ) : null}
            {item.releaseDate ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {item.releaseDate} 首播
              </span>
            ) : null}
            {progressText ? (
              <span className="text-primary">{progressText}</span>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-border/60 pt-4">
            <InfoRow label="类型" value={genres.join(" / ")} />
            <InfoRow label="国家" value={countries.join(" / ")} />
            <InfoRow label="导演" value={directors.join(" / ")} />
            {/* 有 TMDB 头像时主演交给下方演员墙，只有手动录入的才退化成文字行 */}
            {castPortraits.length === 0 ? (
              <InfoRow
                label="主演"
                value={cast.map((c) => c.name).join(" / ")}
              />
            ) : null}
            <InfoRow label="上映" value={formatDate(item.releaseDate, "")} />
            <InfoRow
              label="编号"
              value={externalIds.length > 0 ? externalIds.join(" · ") : null}
            />
            <InfoRow
              label="匹配"
              value={matchStatusLabel(item.matchStatus, item.tmdbId)}
            />
          </div>

          {item.overview ? (
            <div className="space-y-1.5 border-t border-border/60 pt-4">
              <p className="text-xs font-medium text-muted-foreground">简介</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {item.overview}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {castPortraits.length > 0 ? (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">主演</h2>
            <p className="text-xs text-muted-foreground">
              点头像看简介
            </p>
          </div>
          <CastWall cast={castPortraits} />
        </section>
      ) : null}

      {seasons.length > 0 ? (
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">分季</h2>
            <p className="text-xs text-muted-foreground">
              共 {seasons.length} 季
            </p>
          </div>

          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {seasons.map((season) => (
              <SeasonItem
                key={season.seasonNumber}
                season={season}
                workId={item.id}
                seasons={panelSeasons}
                today={today}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">观影记录</h2>
          <p className="text-xs text-muted-foreground">
            共 {records.length} 次
          </p>
        </div>

        {records.length === 0 ? (
          <EmptyState
            icon={isTv ? Tv : Film}
            title="还没有观影记录"
            description="点「记一次观看」写下这次的状态、评分与进度，之后每次重看都会新增一条。"
          />
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {records.map((record) => (
              <ViewRecordItem
                key={record.id}
                record={record}
                mediaType={item.mediaType}
                platforms={platforms}
                defaultPlatformName={defaultPlatform?.name ?? null}
                seasons={seasons}
                tags={tags}
                allTags={allTags}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
