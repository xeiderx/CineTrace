import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CalendarDays, CalendarRange, Clock, Film, ListChecks, Star, Tv } from "lucide-react";
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
import { ViewRecordMatchDialog } from "@/components/library/view-record-match-dialog";
import { WatchingStatusMenu } from "@/components/library/watching-status-menu";
import { SourceChannelSelect } from "@/components/library/source-channel-select";
import { PlatformSelect } from "@/components/library/platform-select";
import { WorkFormDialog } from "@/components/library/work-form-dialog";
import { WorkMatchDialog } from "@/components/library/work-match-dialog";
import { WorkOverview } from "@/components/library/work-overview";
import { WorkTagEditor } from "@/components/library/work-tag-editor";
import {
  RatingStars,
  WorkMetaBadges,
  WorkPoster,
  progressLabel,
} from "@/components/library/work-card";
import { EmptyState } from "@/components/layout/empty-state";
import { BackButton } from "@/components/layout/back-button";
import { Badge } from "@/components/ui/badge";
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
  tagChipStyle,
  viewStatusLabel,
  viewStatusTone,
  type ViewStatus,
} from "@/lib/labels";
import {
  getDefaultPlatform,
  getWorkDetail,
  latestRecord,
  listPlatforms,
  listSourceChannels,
  listTags,
  posterUrl,
  type SeasonWithRecord,
  type SourceChannelNode,
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
function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      {/* 标签列固定成窄宽，值列把剩余宽度全拿走；通栏后不再需要桌面端加宽那一档 */}
      <span className="w-14 shrink-0 text-muted-foreground sm:w-16">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value}</span>
    </div>
  );
}

/** 一轮观看的时间窗。两端都可能缺，缺哪端就只显示另一端 */
type WatchRound = { watchIndex: number; from: string | null; to: string | null };

/**
 * 按刷次归并出每一轮观看的时间窗。
 *
 * 开始取 `startedAt`，没填就退回 `finishedAt`，两个都空才退回标记日期：手动记录时
 * 多数人只知道「哪天看的」，会把日期填在看完日期上，此时它既是这季的结束、也是这季
 * 最可信的开始。直接退到标记日期是错的——那是补记当天，往往晚于真实观看日，
 * 会让「取最早」的一步跳过这一季，从而把整轮的起点抬高到别季的开始日期。
 *
 * 结束取 `finishedAt`，同样退回标记日期。
 *
 * 一轮会横跨好几季——多季剧每季一条流水，所以同一 `watchIndex` 下取最早的开始
 * 与最晚的结束，合起来才是这一轮完整的区间。三个日期全空的流水（想看、弃看）跳过。
 */
function collectWatchRounds(
  records: {
    watchIndex: number;
    watchedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }[],
): WatchRound[] {
  const byRound = new Map<number, { from: string | null; to: string | null }>();
  for (const record of records) {
    // 开始优先用「开始观看」；没填时退回「看完日期」而不是标记日期，
    // 因为手动补记的一条流水常常只填了看完日期，标记日期则是补记当天
    const from = record.startedAt ?? record.finishedAt ?? record.watchedAt;
    const to = record.finishedAt ?? record.watchedAt;
    if (!from && !to) continue;
    const current = byRound.get(record.watchIndex) ?? { from: null, to: null };
    if (from && (current.from === null || from < current.from)) current.from = from;
    if (to && (current.to === null || to > current.to)) current.to = to;
    byRound.set(record.watchIndex, current);
  }
  return [...byRound.entries()]
    .map(([watchIndex, window]) => ({ watchIndex, ...window }))
    .sort((a, b) => a.watchIndex - b.watchIndex);
}

/**
 * 观看数据独立成行：先给整部作品的区间（最早开始 → 最晚结束），
 * 多刷时再把每一轮的时间列出来。
 *
 * 单刷不列明细——一行区间已经把话说完了；只有多刷才需要逐轮对照，
 * 海报上的刷次徽章只给了数字，具体哪轮是什么时候看的得看这里。
 */
function WatchWindow({ rounds }: { rounds: WatchRound[] }) {
  let from: string | null = null;
  let to: string | null = null;
  for (const round of rounds) {
    if (round.from && (from === null || round.from < from)) from = round.from;
    if (round.to && (to === null || round.to > to)) to = round.to;
  }
  const overall = formatDateRange(from, to);

  return (
    <div className="space-y-1">
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CalendarRange className="size-3.5" />
        {overall ? `观看 ${overall}` : "未填写观看时间"}
      </span>
      {rounds.length > 1 ? (
        /* 刷次一多就铺满好几行，手机端尤其臃肿；改成横向滑动，一屏内看完，
           滑到底就知道还有几轮。横向滑动也是这个页面里筛选条、演职员墙的既有做法 */
        <ul className="flex items-center gap-x-4 overflow-x-auto pb-1.5 text-xs text-muted-foreground">
          {rounds.map((round) => (
            <li key={round.watchIndex} className="shrink-0 whitespace-nowrap">
              第 {round.watchIndex} 刷 {formatDateRange(round.from, round.to) ?? "—"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 单条观影流水的展示：状态、评分、时间、平台、剧集进度、短评与该次的标签
 */
function ViewRecordItem({
  record,
  workTitle,
  mediaType,
  platforms,
  defaultPlatformName,
  seasons,
  allTags,
  sourceChannels,
}: {
  record: ViewRecordWithPlatform;
  /** 当前归属作品的片名，重新匹配时作搜索框默认值 */
  workTitle: string;
  mediaType: string;
  platforms: Platform[];
  defaultPlatformName: string | null;
  seasons: SeasonWithRecord[];
  /** 全部标签，透传给弹窗里的标签选择区 */
  allTags: Tag[];
  /** 来源渠道两级树，透传给弹窗里的来源渠道下拉 */
  sourceChannels: SourceChannelNode[];
}) {
  const progress = progressLabel({
    mediaType,
    progressSeason: record.progressSeason,
    progressEpisode: record.progressEpisode,
    episodesWatched: record.episodesWatched,
  });
  const range = formatDateRange(record.startedAt, record.finishedAt);
  // 标记时间与观看窗口讲的是同一次观看，合并成一句连读，省下一行高度。
  // 「开始于 X」只在没有观看区间时才顶上，否则和区间里的左端重复。
  const marker = record.watchedAt
    ? `标记于 ${record.watchedAt}`
    : record.startedAt && !range
      ? `开始于 ${record.startedAt}`
      : null;
  const timeText =
    [marker, range ? `观看 ${range}` : null].filter(Boolean).join(" · ") ||
    "未填写日期";

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
        {/* 第一行是「这是什么状态、从哪看、在哪个平台看、觉得怎么样」，
            渠道与平台都是点击即改的图标，挨在一起才好对照 */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium ${viewStatusTone(record.status)}`}
          >
            {viewStatusLabel(record.status)}
          </span>
          {/* 来源渠道与观影平台都跟在状态徽标旁：选中后就地折叠成纯图标，点图标再展开改 */}
          <SourceChannelSelect
            viewRecordId={record.id}
            current={record.sourceChannelId}
            sourceChannels={sourceChannels}
          />
          <PlatformSelect
            viewRecordId={record.id}
            current={record.platformId}
            platforms={platforms}
          />
          <RatingStars value={record.rating} />
          {/* 豆瓣把它删掉/合并/转私密后本地仍留着这条流水，只是打上时间戳。
              清理与否由用户决定，因此只提示、不自动删。 */}
          {record.doubanRemovedAt ? (
            <span
              className="inline-flex h-5 items-center rounded-4xl bg-amber-500/15 px-2 text-xs font-medium text-amber-400"
              title="最近一次同步时，这条记录已不在豆瓣列表上"
            >
              {DOUBAN_REMOVED_LABEL}
            </span>
          ) : null}
        </div>

        {/* 第二行：时间连读 + 进度 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{timeText}</span>
          {progress ? <span>{progress}</span> : null}
        </div>

        {record.comment ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/90">
            {record.comment}
          </p>
        ) : null}

        {/* 这一条流水自己的标签：一刷「剧情不错」、二刷「不好看」各挂各的，
            不混到作品层面，因此每条记录单独展示 */}
        {record.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {record.tags.map((t) => (
              <Badge
                key={t.id}
                variant="secondary"
                className="font-normal"
                style={tagChipStyle(t.color)}
              >
                {t.name}
              </Badge>
            ))}
          </div>
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
          allTags={allTags}
          sourceChannels={sourceChannels}
        />
        <ViewRecordMatchDialog
          recordId={record.id}
          workTitle={workTitle}
          mediaType={mediaType}
          progressSeason={record.progressSeason}
        />
        <WatchingStatusMenu
          recordId={record.id}
          status={record.status as ViewStatus}
          label={`${workTitle} 第 ${record.watchIndex} 刷`}
          size="icon-sm"
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
  // 已公布未开播的季：集数是 TMDB 的占位值（恒为 1），不能当真实进度展示
  const upcoming = season.upcoming;

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
                {upcoming ? (
                  <span className="inline-flex h-5 items-center rounded-4xl bg-muted px-2 text-xs font-medium text-muted-foreground">
                    未播出
                  </span>
                ) : season.completed ? (
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
                {upcoming ? (
                  <span>已公布，尚未开播</span>
                ) : total > 0 ? (
                  <span>
                    已看 {season.watchedCount}/{total} 集
                  </span>
                ) : (
                  <span>已看 {season.watchedCount} 集</span>
                )}
                {season.airDate ? <span>{season.airDate} 首播</span> : null}
              </div>

              {!upcoming && total > 0 ? (
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

  // 标签挂在流水上，详情页各处的标签都从 records 或 latest 上取，
  // detail.tags 只是 latest.tags 的同义值，这里不再单独解构。
  const { work: item, records, seasons, progress } = detail;
  const platforms = listPlatforms();
  const defaultPlatform = getDefaultPlatform();
  const allTags = listTags();
  const sourceChannels = listSourceChannels();
  const isTv = item.mediaType === "tv";

  const latest = latestRecord(records);
  // 刷次取下流水的最大 watchIndex，不能数流水条数：
  // 豆瓣按季建条目，多季剧一季一条流水，按条数算会把季数当刷数（7 季剧显示成 7 刷）。
  // 各季刷次独立计数，取最大值即「整部重看几轮」
  const watchIndex = records.reduce((max, r) => Math.max(max, r.watchIndex), 1);
  // 整剧进度优先看逐集数据：它比 progressSeason/episodesWatched 这类手填列准；
  // 带上最新状态，弃看的剧才不会在进度里写着「追剧中」
  const progressText = progress
    ? showProgressLabel(progress, latest?.status ?? null)
    : null;
  // 观看数据讲的是整部作品：起止取所有流水里最早开始与最晚结束，多刷时逐轮列出。
  // 单看最新一刷会把「第一轮什么时候看的」丢掉，而这正是重看时最想对照的
  const watchRounds = collectWatchRounds(records);
  // 面板里的季切换、日期默认值都在客户端用，这里把服务端数据裁成纯值再下传
  const today = todayIso();
  const panelSeasons: PanelSeason[] = seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    name: season.name,
    episodeCount: season.episodeCount,
    watchedEpisodes: season.watchedEpisodes,
    completed: season.completed,
    completionSource: season.completionSource,
    upcoming: season.upcoming,
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
            allTags={allTags}
            sourceChannels={sourceChannels}
          />
          <WorkMatchDialog workId={item.id} workTitle={item.title} />
          <WorkFormDialog
            work={item}
            latestRecord={
              latest
                ? {
                    id: latest.id,
                    tags: latest.tags,
                    sourceChannelId: latest.sourceChannelId,
                  }
                : null
            }
            allTags={allTags}
            sourceChannels={sourceChannels}
          />
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

      {/* 窄屏也保持左右两栏：海报单独占一列，名称、标签与信息块都贴着它排，
          否则移动端海报右侧会空出一大片，整页被拉得很长。
          这一栏只放「跟海报同高才好对照」的内容；数据条与简介放在下方通栏，
          免得宽屏时右栏被拉成超宽的衡量，简介每行拖到一百多字。 */}
      <div className="flex items-start gap-4 sm:gap-6">
        <div className="w-28 shrink-0 sm:w-40 md:w-52">
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <WorkPoster
              title={item.title}
              posterPath={item.posterPath}
              watchIndex={watchIndex}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {item.title}
            </h1>
            {item.originalTitle && item.originalTitle !== item.title ? (
              <p className="text-sm text-muted-foreground">{item.originalTitle}</p>
            ) : null}
            {/* 这里不再重复媒体类型：下方类型行已经用图标 + 文字表达过一次 */}
            <WorkMetaBadges
              year={item.year}
              status={latest?.status ?? null}
              country={countries[0] ?? null}
              removedCount={records.filter((r) => r.doubanRemovedAt != null).length}
              // 渠道与平台控件都挂在状态徽标旁：三者都回答「现在是什么情况」，
              // 摆在同一行才好对照；没有流水时无处可挂，退回下方提示
              trailing={
                latest ? (
                  <>
                    <SourceChannelSelect
                      viewRecordId={latest.id}
                      current={latest.sourceChannelId}
                      sourceChannels={sourceChannels}
                    />
                    {/* 平台跟在渠道之后，同样点击即改；这里只留图标，名称进 title */}
                    <PlatformSelect
                      viewRecordId={latest.id}
                      current={latest.platformId}
                      platforms={platforms}
                      variant="icon"
                    />
                  </>
                ) : null
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {isTv ? <Tv className="size-3.5" /> : <Film className="size-3.5" />}
              {mediaTypeLabel(item.mediaType)}
            </span>
            {item.runtime ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Clock className="size-3.5" />
                {isTv ? `单集 ${item.runtime} 分钟` : formatMinutes(item.runtime)}
              </span>
            ) : null}
            {item.seasonCount || item.episodeCount ? (
              <span className="whitespace-nowrap">
                {item.seasonCount ? `${item.seasonCount} 季` : ""}
                {item.seasonCount && item.episodeCount ? " · " : ""}
                {item.episodeCount ? `${item.episodeCount} 集` : ""}
              </span>
            ) : null}
            {item.releaseDate ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <CalendarDays className="size-3.5" />
                {item.releaseDate} 首播
              </span>
            ) : null}
            {progressText ? (
              <span className="whitespace-nowrap text-primary">{progressText}</span>
            ) : null}
          </div>

          {/* 观看数据单独占一行：它是一段区间、多刷时还要逐轮展开，
              夹在类型 / 时长那串短元信息里会被挤成半个换行，读起来断得莫名其妙 */}
          {watchRounds.length > 0 ? <WatchWindow rounds={watchRounds} /> : null}

          {/* 标签行排在类型行之后：标签挂在「最新一次观看」上，
              历史各刷的记在下方各自的流水上，避免互相矛盾的信息堆在一起。
              还没有任何流水时无处可挂，只提示去记一次观看。 */}
          {latest ? (
            <div className="flex flex-wrap items-center gap-2">
              <WorkTagEditor
                viewRecordId={latest.id}
                attached={latest.tags}
                allTags={allTags}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              还没有观影记录，标签与来源渠道都要挂在某一次观看上。
            </p>
          )}
        </div>
      </div>

      {/* 数据条与简介通栏排：它们跟海报没有对照关系，留在右栏只会把右栏
          拉成超宽的衡量——宽屏下每行拖到一百多字，窄屏下又只剩两百来像素，
          编号那行必然折成两截。通栏后桌面端走两列网格、移动端仍是单列。 */}
      <section className="mt-8 space-y-4">
        <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          <InfoRow label="类型" value={genres.join(" / ")} />
          <InfoRow label="国家" value={countries.join(" / ")} />
          <InfoRow label="导演" value={directors.join(" / ")} />
          {/* 有 TMDB 头像时主演交给下方演员墙，只有手动录入的才退化成文字行 */}
          {castPortraits.length === 0 ? (
            <InfoRow label="主演" value={cast.map((c) => c.name).join(" / ")} />
          ) : null}
          <InfoRow label="上映" value={formatDate(item.releaseDate, "")} />
          <InfoRow label="匹配" value={matchStatusLabel(item.matchStatus, item.tmdbId)} />
          <InfoRow
            label="编号"
            value={
              externalIds.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {externalIds.map((id) => (
                    <span
                      key={id}
                      className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs"
                    >
                      {id}
                    </span>
                  ))}
                </span>
              ) : null
            }
          />
        </div>

        {item.overview ? <WorkOverview overview={item.overview} /> : null}
      </section>

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
                workTitle={item.title}
                mediaType={item.mediaType}
                platforms={platforms}
                defaultPlatformName={defaultPlatform?.name ?? null}
                seasons={seasons}
                allTags={allTags}
                sourceChannels={sourceChannels}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
