import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import {
  platform,
  sourceChannel,
  tag,
  viewEpisode,
  viewRecord,
  viewRecordTag,
  work,
  type Platform,
  type SourceChannel,
  type Tag,
  type ViewRecord,
  type Work,
} from "@/db/schema";
import { pendingMetadataWhere } from "@/lib/backup";
import { DOUBAN_REMOVED_FILTER, PENDING_METADATA_FILTER } from "@/lib/labels";
import {
  buildShowProgress,
  type EpisodeMark,
  type ProgressRecordInput,
  type SeasonStats,
  type ShowProgress,
} from "@/lib/watch-progress";

/* -------------------------------------------------------------------------- */
/*                                  展示辅助                                    */
/* -------------------------------------------------------------------------- */

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/**
 * TMDB 返回的海报路径形如 `/abc.jpg`，需要拼上图片域名；
 * 手动录入的作品允许直接填完整外链，此时原样返回。
 */
export function posterUrl(
  path: string | null | undefined,
  size: "w185" | "w342" | "w500" = "w342",
): string | null {
  if (!path?.trim()) return null;
  const value = path.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `${TMDB_IMAGE_BASE}/${size}${value.startsWith("/") ? value : `/${value}`}`;
}

/* -------------------------------------------------------------------------- */
/*                                  平台 / 标签                                 */
/* -------------------------------------------------------------------------- */

export function listPlatforms(): Platform[] {
  return db
    .select()
    .from(platform)
    .orderBy(desc(platform.isDefault), asc(platform.sortOrder), asc(platform.id))
    .all();
}

/**
 * 默认观影平台：观影记录未显式指定平台时落到这里。
 * 若用户从未标记默认项，退化为排序最靠前的一个。
 */
export function getDefaultPlatform(): Platform | null {
  const rows = listPlatforms();
  return rows.find((p) => p.isDefault) ?? rows[0] ?? null;
}

export function listTags(): Tag[] {
  return db.select().from(tag).orderBy(asc(tag.name)).all();
}

/** 各观影平台被多少条流水引用，用于设置页展示与删除前提示 */
export function platformUsage(): Record<number, number> {
  const rows = db
    .select({ id: viewRecord.platformId, value: sql<number>`count(*)` })
    .from(viewRecord)
    .groupBy(viewRecord.platformId)
    .all();

  const usage: Record<number, number> = {};
  for (const row of rows) {
    if (row.id != null) usage[row.id] = row.value;
  }
  return usage;
}

/** 各标签挂在多少条观影流水上 */
export function tagUsage(): Record<number, number> {
  const rows = db
    .select({ id: viewRecordTag.tagId, value: sql<number>`count(*)` })
    .from(viewRecordTag)
    .groupBy(viewRecordTag.tagId)
    .all();

  const usage: Record<number, number> = {};
  for (const row of rows) usage[row.id] = row.value;
  return usage;
}

/* -------------------------------------------------------------------------- */
/*                                 来源渠道                                     */
/* -------------------------------------------------------------------------- */

/** 一级来源渠道，附带其下的二级分类 */
export type SourceChannelNode = SourceChannel & { children: SourceChannel[] };

/**
 * 取全部来源渠道，组装成两级树。
 *
 * 只查一次表，在内存里分组：渠道数量是几十条量级，两次查询没有必要。
 * 排序沿用 platform 的口径：sortOrder 升序，同值按 id 升序（即创建先后）。
 */
export function listSourceChannels(): SourceChannelNode[] {
  const rows = db
    .select()
    .from(sourceChannel)
    .orderBy(asc(sourceChannel.sortOrder), asc(sourceChannel.id))
    .all();

  const childrenByParent = new Map<number, SourceChannel[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    const bucket = childrenByParent.get(row.parentId);
    if (bucket) bucket.push(row);
    else childrenByParent.set(row.parentId, [row]);
  }

  return rows
    .filter((row) => row.parentId == null)
    .map((row) => ({ ...row, children: childrenByParent.get(row.id) ?? [] }));
}

/** 拍平成一维（一级在前、其后紧跟其子级），便于下拉与查找 */
export function flattenSourceChannels(nodes: SourceChannelNode[]): SourceChannel[] {
  return nodes.flatMap((node) => [node, ...node.children]);
}

/**
 * 各来源渠道被多少条流水引用。
 * 一级分类的数字**不含**其子级——父子各自统计，与设置页展示一致。
 */
export function sourceChannelUsage(): Record<number, number> {
  const rows = db
    .select({ id: viewRecord.sourceChannelId, value: sql<number>`count(*)` })
    .from(viewRecord)
    .groupBy(viewRecord.sourceChannelId)
    .all();

  const usage: Record<number, number> = {};
  for (const row of rows) {
    if (row.id != null) usage[row.id] = row.value;
  }
  return usage;
}

/* -------------------------------------------------------------------------- */
/*                                  追剧进度                                    */
/* -------------------------------------------------------------------------- */

/**
 * 批量取逐集记录并按作品分组。
 *
 * 列表页与详情页共用：一次把要展示的作品的逐集记录全查出来，
 * 避免每部作品各查一次（列表一页 20 部就是 20 条查询）。
 */
function episodeMarksByWork(workIds: number[]): Map<number, EpisodeMark[]> {
  const grouped = new Map<number, EpisodeMark[]>();
  if (workIds.length === 0) return grouped;

  const rows = db
    .select({
      workId: viewEpisode.workId,
      seasonNumber: viewEpisode.seasonNumber,
      episodeNumber: viewEpisode.episodeNumber,
      watchedAt: viewEpisode.watchedAt,
    })
    .from(viewEpisode)
    .where(inArray(viewEpisode.workId, workIds))
    .all();

  for (const row of rows) {
    const mark: EpisodeMark = {
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      watchedAt: row.watchedAt,
    };
    const bucket = grouped.get(row.workId);
    if (bucket) bucket.push(mark);
    else grouped.set(row.workId, [mark]);
  }
  return grouped;
}

/**
 * 一部作品的追剧进度。规则全部在 `lib/watch-progress.ts`，这里只负责把
 * 数据库的行喂进去。电影返回 null——没有分季结构，集数进度也无意义。
 *
 * 逐集记录不分刷次：进度回答的是「这部剧我看过哪些集」，重刷不会让进度倒退。
 * 真要按刷次分开算，得上 `view_episode.watchIndex`，那是另一回事。
 */
function buildProgress(
  item: Pick<Work, "mediaType" | "seasonsJson" | "episodeCount">,
  records: ProgressRecordInput[],
  episodes: EpisodeMark[],
): ShowProgress | null {
  if (item.mediaType !== "tv") return null;
  return buildShowProgress({
    seasons: parseSeasons(item.seasonsJson),
    episodes,
    records,
    episodeCount: item.episodeCount,
  });
}

/* -------------------------------------------------------------------------- */
/*                                  档案库列表                                  */
/* -------------------------------------------------------------------------- */

export type WorkFilters = {
  q?: string;
  mediaType?: string;
  status?: string;
  /** 匹配状态，取值同 work.match_status */
  matchStatus?: string;
  /** 制片国家，精确匹配 countries 数组里的一项 */
  country?: string;
  /** 类型标签，精确匹配 genres 数组里的一项 */
  genre?: string;
  /** 只留含「豆瓣已移除」记录的作品，取值 DOUBAN_REMOVED_FILTER */
  removed?: string;
  sort?: "recent" | "rating" | "title" | "year";
};

/** 筛选项及其在库内的作品数，用于下拉里带上数量 */
export type FacetItem = { value: string; count: number };

/**
 * JSON 数组列里是否含有某一项。
 * 国家与类型存在 JSON 数组里，逐个 json_each 展开后再比对值，
 * 比字符串 LIKE 可靠（不会把「中国」误匹配到「中国大陆」）。
 */
function jsonArrayHas(column: AnySQLiteColumn, value: string) {
  return sql`exists (select 1 from json_each(${column}) where json_each.value = ${value})`;
}

/** 统计 JSON 数组列的取值分布，按作品数由多到少排序，数量相同按名称 */
function jsonFacet(column: AnySQLiteColumn): FacetItem[] {
  // 展开 JSON 数组要 cross join json_each，Drizzle 的 from 只收一张表，这里用原生 SQL
  return db.all<FacetItem>(sql`
    select json_each.value as value, count(*) as count
    from ${work}, json_each(${column})
    where json_each.value is not null
    group by json_each.value
    order by count desc, value asc
  `);
}

/** 制片国家分布，供筛选下拉展示（已按数量降序） */
export function listCountryFacets(): FacetItem[] {
  return jsonFacet(work.countries);
}

/** 类型分布（恐怖、悬疑……），供筛选下拉展示（已按数量降序） */
export function listGenreFacets(): FacetItem[] {
  return jsonFacet(work.genres);
}

export type WorkListItem = Work & {
  viewCount: number;
  /**
   * 刷到第几刷，取名下流水 `watchIndex` 的最大值；1 表示只看过一遍，0 条流水也是 1。
   * 海报右上角的刷次徽章只在 ≥2 时出现。
   *
   * 不能拿流水条数当刷数：豆瓣按季建条目，一季一条流水，
   * 多季剧会被算成多刷（早期版本就是这么错的，7 季的剧显示成「7 刷」）。
   */
  watchIndex: number;
  /**
   * 状态为「看过」的记录条数。档案库顶部的流水数用这一列，
   * 口径与豆瓣「看过」一致，才能和同步区的对照行对上。
   */
  watchedCount: number;
  lastWatchedAt: string | null;
  latestStatus: string | null;
  /** 最近一条流水的 id。卡片上的状态快捷切换要拿它去改，不必再查一次库 */
  latestRecordId: number | null;
  latestRating: number | null;
  /** 最近一条观后记录上的剧集进度 */
  progressSeason: number | null;
  progressEpisode: number | null;
  episodesWatched: number | null;
  /**
   * 逐集记录里最近一次观看的日期。
   * 它比 `lastWatchedAt` 更贴近「最近追到哪」——逐集标记是当场点出来的，
   * 而豆瓣流水可能几周都没同步过。没有逐集记录时为 null。
   */
  lastEpisodeAt: string | null;
  /**
   * 由逐集记录派生的追剧进度，电影为 null。
   * 卡片的进度文案优先用它，它比上面三个手填列更准（能算出 x/N 集与季数）。
   */
  progress: ShowProgress | null;
  /** 名下带有「豆瓣已移除」标记的记录条数 */
  removedCount: number;
  tags: Tag[];
};

/** 取最近一次观看；`watchedAt` 为空时退化为 id 最大者 */
export function latestRecord<T extends { watchedAt: string | null; id: number }>(
  records: T[],
): T | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => {
    const left = a.watchedAt ?? "";
    const right = b.watchedAt ?? "";
    if (left !== right) return left < right ? 1 : -1;
    return b.id - a.id;
  })[0];
}

function pickLatest(records: ViewRecord[]): ViewRecord | null {
  return latestRecord(records);
}

/** 逐集记录里最近的标记日期。ISO 文本按字典序比较即等价于按时间比较 */
function latestEpisodeDate(marks: EpisodeMark[]): string | null {
  let best: string | null = null;
  for (const mark of marks) {
    const value = mark.watchedAt?.trim();
    if (!value) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

/**
 * 档案库列表。作品与观影流水在 JS 层聚合：
 * 单用户数据量下比多表窗口函数更好读，也避免 SQLite 子查询嵌套。
 */
export function listWorks(filters: WorkFilters = {}): WorkListItem[] {
  const conditions = [];

  if (filters.q?.trim()) {
    const needle = `%${filters.q.trim()}%`;
    conditions.push(
      or(
        like(work.title, needle),
        like(work.originalTitle, needle),
        like(work.doubanId, needle),
        like(work.imdbId, needle),
      ),
    );
  }
  if (filters.mediaType) conditions.push(eq(work.mediaType, filters.mediaType));

  // 匹配状态分档与库里存的值不完全一一对应：
  // 「已匹配」把手动绑定但拿到了 TMDB 数据的也收进来，「自由添加」只留没有 TMDB 数据的手工条目；
  // 「待补全」是派生条件（有 tmdbId 但元数据没拉全），不是 match_status 的取值
  if (filters.matchStatus === "matched") {
    conditions.push(
      or(
        eq(work.matchStatus, "matched"),
        and(eq(work.matchStatus, "manual"), isNotNull(work.tmdbId)),
      ),
    );
  } else if (filters.matchStatus === "manual") {
    conditions.push(and(eq(work.matchStatus, "manual"), isNull(work.tmdbId)));
  } else if (filters.matchStatus === PENDING_METADATA_FILTER) {
    conditions.push(pendingMetadataWhere);
  } else if (filters.matchStatus) {
    conditions.push(eq(work.matchStatus, filters.matchStatus));
  }

  // 国家与类型存在 JSON 数组列里，用 json_each 展开后精确比对其中一项
  if (filters.country) conditions.push(jsonArrayHas(work.countries, filters.country));
  if (filters.genre) conditions.push(jsonArrayHas(work.genres, filters.genre));

  // 状态筛选作用于「是否看过某条记录」，用子查询表达更直观
  if (filters.status) {
    conditions.push(
      sql`exists (select 1 from ${viewRecord} where ${viewRecord.workId} = ${work.id} and ${viewRecord.status} = ${filters.status})`,
    );
  }

  // 「豆瓣已移除」：只看名下带有该标记记录的作品，同样用子查询
  if (filters.removed === DOUBAN_REMOVED_FILTER) {
    conditions.push(
      sql`exists (select 1 from ${viewRecord} where ${viewRecord.workId} = ${work.id} and ${viewRecord.doubanRemovedAt} is not null)`,
    );
  }

  const works = db
    .select()
    .from(work)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(work.title))
    .all();

  if (works.length === 0) return [];

  const workIds = works.map((w) => w.id);

  const records = db
    .select()
    .from(viewRecord)
    .where(inArray(viewRecord.workId, workIds))
    .all();

  const episodesByWork = episodeMarksByWork(workIds);

  // 标签挂在观影流水上，列表卡片只展示「最新一次观看」的标签，
  // 因此先取出这批作品名下所有流水的标签，再按流水归组，最后落到最新那条上。
  const recordIds = records.map((r) => r.id);
  const tagRows =
    recordIds.length === 0
      ? []
      : db
          .select({ viewRecordId: viewRecordTag.viewRecordId, tag })
          .from(viewRecordTag)
          .innerJoin(tag, eq(tag.id, viewRecordTag.tagId))
          .where(inArray(viewRecordTag.viewRecordId, recordIds))
          .all();

  const recordsByWork = new Map<number, ViewRecord[]>();
  for (const record of records) {
    if (record.workId == null) continue;
    const bucket = recordsByWork.get(record.workId);
    if (bucket) bucket.push(record);
    else recordsByWork.set(record.workId, [record]);
  }

  const tagsByRecord = new Map<number, Tag[]>();
  for (const row of tagRows) {
    const bucket = tagsByRecord.get(row.viewRecordId);
    if (bucket) bucket.push(row.tag);
    else tagsByRecord.set(row.viewRecordId, [row.tag]);
  }

  const items: WorkListItem[] = works.map((w) => {
    const own = recordsByWork.get(w.id) ?? [];
    const latest = pickLatest(own);
    const marks = episodesByWork.get(w.id) ?? [];
    return {
      ...w,
      viewCount: own.length,
      watchIndex: own.reduce((max, r) => Math.max(max, r.watchIndex), 1),
      watchedCount: own.filter((r) => r.status === "watched").length,
      lastWatchedAt: latest?.watchedAt ?? null,
      latestStatus: latest?.status ?? null,
      latestRecordId: latest?.id ?? null,
      latestRating: latest?.rating ?? null,
      progressSeason: latest?.progressSeason ?? null,
      progressEpisode: latest?.progressEpisode ?? null,
      episodesWatched: latest?.episodesWatched ?? null,
      lastEpisodeAt: latestEpisodeDate(marks),
      progress: buildProgress(w, own, marks),
      removedCount: own.filter((r) => r.doubanRemovedAt != null).length,
      tags: latest ? (tagsByRecord.get(latest.id) ?? []) : [],
    };
  });

  return sortWorks(items, filters.sort ?? "recent");
}

/**
 * 档案库每页作品数。
 * 取 20 是为了在 2/4/5 列三档栅格下都能整行排满（对应手机 / 平板起 / 宽屏），
 * 不会在末行留下空位——格里宁可少几部，也不要一格突兀的空白。
 */
export const LIBRARY_PAGE_SIZE = 20;

export type PagedResult<T> = {
  items: T[];
  /** 当前页码，已收敛到 1..pageCount */
  page: number;
  pageSize: number;
  /** 满足筛选条件的作品总数 */
  total: number;
  /**
   * 这些作品名下的「已看」流水条数。与 total 并列展示，用来消除
   * 「一部剧算几部」的歧义——多季剧只占一行作品，每季却各有一条流水。
   */
  recordTotal: number;
  /** 总页数，无结果时仍为 1，便于直接展示「第 1 / 1 页」 */
  pageCount: number;
};

function toPositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * 档案库分页查询。
 *
 * 排序口径依赖观影流水的聚合结果（最近观看时间、最近评分），
 * SQL 里要写成相关子查询才等价；而「按片名」用的
 * `localeCompare(..., "zh-CN")` SQLite 无法复现。
 * 因此这里沿用 listWorks 的全量聚合，再在内存里切片：
 * 单用户库量级下开销可忽略，换来的是分页前后排序结果完全一致。
 */
export function listWorksPage(
  filters: WorkFilters = {},
  page = 1,
  pageSize = LIBRARY_PAGE_SIZE,
): PagedResult<WorkListItem> {
  const size = toPositiveInt(pageSize, LIBRARY_PAGE_SIZE);
  const all = listWorks(filters);
  const total = all.length;
  // 「已看」流水数只能在内存里加出来：它来自 listWorks 聚合出的每条 work 的 watchedCount，
  // 而那条判定跨列，写 SQL 反而不如直接汇总清晰
  const recordTotal = all.reduce((sum, item) => sum + item.watchedCount, 0);
  const pageCount = Math.max(1, Math.ceil(total / size));
  // 手改 URL、筛选后页数变少等情况都会让页码越界，统一收敛，
  // 否则用户会看到一页空白，误以为数据没了
  const current = Math.min(toPositiveInt(page, 1), pageCount);
  const start = (current - 1) * size;

  return {
    items: all.slice(start, start + size),
    page: current,
    pageSize: size,
    total,
    recordTotal,
    pageCount,
  };
}

function sortWorks(items: WorkListItem[], sort: NonNullable<WorkFilters["sort"]>) {
  const sorted = [...items];
  switch (sort) {
    case "rating":
      return sorted.sort((a, b) => (b.latestRating ?? -1) - (a.latestRating ?? -1));
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    case "year":
      return sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "recent":
    default:
      return sorted.sort((a, b) => {
        const left = a.lastWatchedAt ?? "";
        const right = b.lastWatchedAt ?? "";
        if (left !== right) return left < right ? 1 : -1;
        return b.id - a.id;
      });
  }
}

/* -------------------------------------------------------------------------- */
/*                                  作品详情                                    */
/* -------------------------------------------------------------------------- */

export type ViewRecordWithPlatform = ViewRecord & {
  platformName: string | null;
  platformColor: string | null;
  platformIcon: string | null;
  isDefaultPlatform: boolean;
  /** 这次观看指定的来源渠道；未指定时全为 null */
  sourceChannelName: string | null;
  sourceChannelIcon: string | null;
  sourceChannelColor: string | null;
  /** 所选渠道的上级一级分类名。选中的本身就是一级时为 null */
  sourceChannelParentName: string | null;
  /** 挂在这一次观看上的标签。标签属于流水，不跨刷次共享 */
  tags: Tag[];
};

/** `work.seasonsJson` 的一项，对应 TMDB `/tv/{id}` 的 `seasons[]`。 */
export type WorkSeason = {
  seasonNumber: number;
  name: string;
  airDate: string | null;
  episodeCount: number;
  posterPath: string | null;
  voteAverage: number | null;
};

/** 分季结构 + 逐集派生出的该季进度（含该季豆瓣标记与评分）。 */
export type SeasonWithRecord = SeasonStats;

export type WorkDetail = {
  work: Work;
  records: ViewRecordWithPlatform[];
  /** 最新一次观看的标签。详情页顶部展示的就是它，与列表卡片口径一致 */
  tags: Tag[];
  /** 仅剧集非空；已按季号与观影记录、逐集记录合并 */
  seasons: SeasonWithRecord[];
  /** 整剧追剧进度；电影或没有分季结构时为 null */
  progress: ShowProgress | null;
  /** 全部逐集记录，按季号、集号升序。进度面板据此渲染集号网格 */
  episodes: EpisodeMark[];
};

/** 解析 seasonsJson。任何异常一律当空数组，坏数据不该让页面挂掉。 */
export function parseSeasons(json: string | null | undefined): WorkSeason[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is WorkSeason =>
          typeof s === "object" && s !== null && typeof (s as WorkSeason).seasonNumber === "number",
      )
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
  } catch {
    return [];
  }
}

/**
 * 把 TMDB 的季结构与豆瓣标记、逐集记录对齐，算出每一季的进度与起止时间。
 *
 * 真正的规则在 `lib/watch-progress.ts` 的 `buildShowProgress`：豆瓣「看过」的
 * 补齐、`progressEpisode` 的兜底展开、季完成判定都在那边，这里只做取数。
 */
function mergeSeasons(
  item: Pick<Work, "seasonsJson" | "episodeCount">,
  records: ProgressRecordInput[],
  episodes: EpisodeMark[],
): SeasonWithRecord[] {
  const seasons = parseSeasons(item.seasonsJson);
  if (seasons.length === 0) return [];

  return buildShowProgress({
    seasons,
    episodes,
    records,
    episodeCount: item.episodeCount,
  }).seasons;
}

export function getWorkDetail(workId: number): WorkDetail | null {
  const row = db.select().from(work).where(eq(work.id, workId)).get();
  if (!row) return null;

  const defaultPlatform = getDefaultPlatform();

  const rows = db
    .select({ record: viewRecord, platform, channel: sourceChannel })
    .from(viewRecord)
    .leftJoin(platform, eq(platform.id, viewRecord.platformId))
    .leftJoin(sourceChannel, eq(sourceChannel.id, viewRecord.sourceChannelId))
    .where(eq(viewRecord.workId, workId))
    .orderBy(desc(viewRecord.watchIndex), asc(viewRecord.id))
    .all();

  /*
   * 二级渠道要顺带显示所属一级名（如「PT站点 › 彩虹岛」）。
   * 渠道表只有几十行，一次性读出来建映射，比自连接省事也更好读。
   */
  const channelNameById = new Map(
    db
      .select({ id: sourceChannel.id, name: sourceChannel.name })
      .from(sourceChannel)
      .all()
      .map((c) => [c.id, c.name]),
  );

  const baseRecords: ViewRecordWithPlatform[] = rows.map(
    ({ record, platform: p, channel }) => ({
      ...record,
      // 记录未指定平台时展示默认平台，且标注为「默认」
      platformName: p?.name ?? defaultPlatform?.name ?? null,
      platformColor: p?.color ?? defaultPlatform?.color ?? null,
      platformIcon: p?.icon ?? defaultPlatform?.icon ?? null,
      isDefaultPlatform: record.platformId == null,
      sourceChannelName: channel?.name ?? null,
      sourceChannelIcon: channel?.iconData ?? null,
      sourceChannelColor: channel?.color ?? null,
      sourceChannelParentName:
        channel?.parentId != null ? channelNameById.get(channel.parentId) ?? null : null,
      tags: [],
    }),
  );

  // 标签按流水取：每条记录只带自己那一次的标签，互不混淆
  const tagRows = db
    .select({ viewRecordId: viewRecordTag.viewRecordId, tag })
    .from(viewRecordTag)
    .innerJoin(tag, eq(tag.id, viewRecordTag.tagId))
    .where(
      inArray(
        viewRecordTag.viewRecordId,
        rows.map((r) => r.record.id),
      ),
    )
    .all();

  const tagsByRecord = new Map<number, Tag[]>();
  for (const row of tagRows) {
    const bucket = tagsByRecord.get(row.viewRecordId);
    if (bucket) bucket.push(row.tag);
    else tagsByRecord.set(row.viewRecordId, [row.tag]);
  }

  const records = baseRecords.map((record) => ({
    ...record,
    tags: tagsByRecord.get(record.id) ?? [],
  }));

  // 顶部展示「最新一次观看」的标签，与档案库卡片口径一致
  const latest = latestRecord(records);
  const tags = latest?.tags ?? [];

  const episodes = episodeMarksByWork([workId]).get(workId) ?? [];

  return {
    work: row,
    records,
    tags,
    seasons: mergeSeasons(row, records, episodes),
    progress: buildProgress(row, records, episodes),
    episodes,
  };
}

/* -------------------------------------------------------------------------- */
/*                                    概览                                      */
/* -------------------------------------------------------------------------- */

export type OverviewStats = {
  /** 作品实体数：同剧多季只算 1 部 */
  workCount: number;
  movieCount: number;
  tvCount: number;
  /** 「看过」流水条数，与豆瓣「已看」同口径（作品数则受整季归并影响而更少） */
  watchedRecordCount: number;
  /** 有看过日期的天数，同一天看多部只算一天 */
  watchDays: number;
  /** 最早的一个看过日期（`YYYY-MM-DD`），没有则 null */
  firstWatchedAt: string | null;
  /** 看过日期落在今年的流水条数 */
  thisYearCount: number;
  /** 去年全年的流水条数，仅用于给「今年」一个参照 */
  lastYearCount: number;
  /** 看过 2 次及以上的作品数，按作品去重 */
  rewatchWorkCount: number;
  /**
   * 带「豆瓣已移除」标记的流水条数。这些记录仍在库里、仍计入上面的
   * watchedRecordCount，只是最后一次全量同步在豆瓣列表上没再见到它们；
   * 单独列出来是为了让用户决定要不要清理。
   */
  doubanRemovedCount: number;
};

export function getOverviewStats(): OverviewStats {
  const mediaCounts = db
    .select({ mediaType: work.mediaType, n: count() })
    .from(work)
    .groupBy(work.mediaType)
    .all();

  let movieCount = 0;
  let tvCount = 0;
  for (const row of mediaCounts) {
    if (row.mediaType === "tv") tvCount += row.n;
    else movieCount += row.n;
  }

  // 豆瓣「已看」口径：只要状态是看过就算一条，与是否填了日期无关。
  const watchedRecordCount =
    db
      .select({ n: count() })
      .from(viewRecord)
      .where(eq(viewRecord.status, "watched"))
      .get()?.n ?? 0;

  // 「有看过日期就算数」：状态后来被豆瓣改回「想看」的记录，那天确实看过的历史仍然成立，
  // 不能因为状态变了就把这一笔从天数与年度统计里抹掉。
  const year = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);
  const dateStats = db
    .select({
      watchDays: sql<number>`count(distinct ${viewRecord.watchedAt})`,
      firstWatchedAt: sql<string | null>`min(${viewRecord.watchedAt})`,
      thisYearCount: sql<number>`coalesce(sum(substr(${viewRecord.watchedAt}, 1, 4) = ${year}), 0)`,
      lastYearCount: sql<number>`coalesce(sum(substr(${viewRecord.watchedAt}, 1, 4) = ${lastYear}), 0)`,
    })
    .from(viewRecord)
    .where(isNotNull(viewRecord.watchedAt))
    .get();

  const rewatchWorkCount =
    db
      .select({ n: sql<number>`count(distinct ${viewRecord.workId})` })
      .from(viewRecord)
      .where(gt(viewRecord.watchIndex, 1))
      .get()?.n ?? 0;

  const doubanRemovedCount =
    db
      .select({ n: count() })
      .from(viewRecord)
      .where(isNotNull(viewRecord.doubanRemovedAt))
      .get()?.n ?? 0;

  return {
    workCount: movieCount + tvCount,
    movieCount,
    tvCount,
    watchedRecordCount,
    watchDays: dateStats?.watchDays ?? 0,
    firstWatchedAt: dateStats?.firstWatchedAt ?? null,
    thisYearCount: dateStats?.thisYearCount ?? 0,
    lastYearCount: dateStats?.lastYearCount ?? 0,
    rewatchWorkCount,
    doubanRemovedCount,
  };
}

export type RecentWatch = {
  record: ViewRecord;
  work: Work | null;
};

/* -------------------------------------------------------------------------- */
/*                               演员的库内作品                                 */
/* -------------------------------------------------------------------------- */

export type PersonWork = {
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
};

/**
 * 某位演员在你库里参演过的作品，按年份倒序。
 *
 * `work.cast` 是 JSON 数组，用 json_each 展开后按 person id 比对。
 * 老格式（纯姓名数组）没有 id，自然匹配不上——那些本来也拿不到头像。
 */
export function listWorksByCastId(personId: number): PersonWork[] {
  return db
    .select({
      id: work.id,
      title: work.title,
      year: work.year,
      posterPath: work.posterPath,
    })
    .from(work)
    .where(
      sql`exists (select 1 from json_each(${work.cast}) where json_extract(json_each.value, '$.id') = ${personId})`,
    )
    .orderBy(desc(work.year), asc(work.title))
    .all();
}

/**
 * 最近观看：概览页的时间线。
 * 「想看」如果从没看过（没日期）只是标记，不该出现在观看时间线里；
 * 但状态被改回「想看」的旧记录保留着看过日期，那天确实看过，照常列出。
 */
export function listRecentWatches(limit = 8): RecentWatch[] {
  return db
    .select({ record: viewRecord, work })
    .from(viewRecord)
    .leftJoin(work, eq(work.id, viewRecord.workId))
    .where(or(eq(viewRecord.status, "watched"), isNotNull(viewRecord.watchedAt)))
    .orderBy(desc(viewRecord.watchedAt), desc(viewRecord.id))
    .limit(limit)
    .all();
}
