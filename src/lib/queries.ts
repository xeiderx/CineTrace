import { and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import {
  platform,
  tag,
  viewRecord,
  work,
  workTag,
  type Platform,
  type Tag,
  type ViewRecord,
  type Work,
} from "@/db/schema";

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

/** 各标签挂在多少部作品上 */
export function tagUsage(): Record<number, number> {
  const rows = db
    .select({ id: workTag.tagId, value: sql<number>`count(*)` })
    .from(workTag)
    .groupBy(workTag.tagId)
    .all();

  const usage: Record<number, number> = {};
  for (const row of rows) usage[row.id] = row.value;
  return usage;
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
  watchCount: number;
  lastWatchedAt: string | null;
  latestStatus: string | null;
  latestRating: number | null;
  /** 最近一条观后记录上的剧集进度 */
  progressSeason: number | null;
  progressEpisode: number | null;
  episodesWatched: number | null;
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
  // 「已匹配」把手动绑定但拿到了 TMDB 数据的也收进来，「自由添加」只留没有 TMDB 数据的手工条目
  if (filters.matchStatus === "matched") {
    conditions.push(
      or(
        eq(work.matchStatus, "matched"),
        and(eq(work.matchStatus, "manual"), isNotNull(work.tmdbId)),
      ),
    );
  } else if (filters.matchStatus === "manual") {
    conditions.push(and(eq(work.matchStatus, "manual"), isNull(work.tmdbId)));
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

  const tagRows = db
    .select({ workId: workTag.workId, tag: tag })
    .from(workTag)
    .innerJoin(tag, eq(tag.id, workTag.tagId))
    .where(inArray(workTag.workId, workIds))
    .all();

  const recordsByWork = new Map<number, ViewRecord[]>();
  for (const record of records) {
    if (record.workId == null) continue;
    const bucket = recordsByWork.get(record.workId);
    if (bucket) bucket.push(record);
    else recordsByWork.set(record.workId, [record]);
  }

  const tagsByWork = new Map<number, Tag[]>();
  for (const row of tagRows) {
    const bucket = tagsByWork.get(row.workId);
    if (bucket) bucket.push(row.tag);
    else tagsByWork.set(row.workId, [row.tag]);
  }

  const items: WorkListItem[] = works.map((w) => {
    const own = recordsByWork.get(w.id) ?? [];
    const latest = pickLatest(own);
    return {
      ...w,
      viewCount: own.length,
      watchCount: own.filter((r) => r.watchedAt != null || r.status === "watched").length,
      lastWatchedAt: latest?.watchedAt ?? null,
      latestStatus: latest?.status ?? null,
      latestRating: latest?.rating ?? null,
      progressSeason: latest?.progressSeason ?? null,
      progressEpisode: latest?.progressEpisode ?? null,
      episodesWatched: latest?.episodesWatched ?? null,
      tags: tagsByWork.get(w.id) ?? [],
    };
  });

  return sortWorks(items, filters.sort ?? "recent");
}

/**
 * 档案库每页作品数。
 * 取 24 是因为在常用的 2/3/4 列栅格下都能整行排满，
 * 只有 xl 的 5 列末行会不满，视觉上可接受。
 */
export const LIBRARY_PAGE_SIZE = 24;

export type PagedResult<T> = {
  items: T[];
  /** 当前页码，已收敛到 1..pageCount */
  page: number;
  pageSize: number;
  /** 满足筛选条件的作品总数 */
  total: number;
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

export function countWorks(): number {
  const row = db.select({ value: sql<number>`count(*)` }).from(work).get();
  return row?.value ?? 0;
}

/* -------------------------------------------------------------------------- */
/*                                  作品详情                                    */
/* -------------------------------------------------------------------------- */

export type ViewRecordWithPlatform = ViewRecord & {
  platformName: string | null;
  platformColor: string | null;
  platformIcon: string | null;
  isDefaultPlatform: boolean;
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

/** 分季结构 + 该季在豆瓣的标记（星级 / 标记时间），没有标记时为 null。 */
export type SeasonWithRecord = WorkSeason & {
  record: ViewRecord | null;
};

export type WorkDetail = {
  work: Work;
  records: ViewRecordWithPlatform[];
  tags: Tag[];
  /** 仅剧集非空；已按季号与观影记录合并 */
  seasons: SeasonWithRecord[];
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
 * 把 TMDB 的季结构与豆瓣标记按季号对齐。
 * 豆瓣一季一条观影记录，季号记在 progressSeason 上；同一季有多条时取最近一条。
 */
function mergeSeasons(work: Work, records: ViewRecord[]): SeasonWithRecord[] {
  const seasons = parseSeasons(work.seasonsJson);
  if (seasons.length === 0) return [];

  const bySeason = new Map<number, ViewRecord[]>();
  for (const record of records) {
    if (record.progressSeason == null) continue;
    const bucket = bySeason.get(record.progressSeason);
    if (bucket) bucket.push(record);
    else bySeason.set(record.progressSeason, [record]);
  }

  const merged = seasons.map((season) => ({
    ...season,
    record: latestRecord(bySeason.get(season.seasonNumber) ?? []),
  }));

  // 只有一季的剧，豆瓣标题通常不带「第X季」，记录上就没有季号；
  // 此时直接把记录归到唯一那一季，否则标记时间会无处显示。
  if (merged.length === 1 && merged[0].record === null && bySeason.size === 0) {
    merged[0].record = latestRecord(records);
  }

  return merged;
}

export function getWorkDetail(workId: number): WorkDetail | null {
  const row = db.select().from(work).where(eq(work.id, workId)).get();
  if (!row) return null;

  const defaultPlatform = getDefaultPlatform();

  const rows = db
    .select({ record: viewRecord, platform })
    .from(viewRecord)
    .leftJoin(platform, eq(platform.id, viewRecord.platformId))
    .where(eq(viewRecord.workId, workId))
    .orderBy(desc(viewRecord.watchIndex), asc(viewRecord.id))
    .all();

  const records: ViewRecordWithPlatform[] = rows.map(({ record, platform: p }) => ({
    ...record,
    // 记录未指定平台时展示默认平台，且标注为「默认」
    platformName: p?.name ?? defaultPlatform?.name ?? null,
    platformColor: p?.color ?? defaultPlatform?.color ?? null,
    platformIcon: p?.icon ?? defaultPlatform?.icon ?? null,
    isDefaultPlatform: record.platformId == null,
  }));

  const tags = db
    .select({ tag })
    .from(workTag)
    .innerJoin(tag, eq(tag.id, workTag.tagId))
    .where(eq(workTag.workId, workId))
    .all()
    .map((r) => r.tag);

  return { work: row, records, tags, seasons: mergeSeasons(row, records) };
}

/* -------------------------------------------------------------------------- */
/*                                    概览                                      */
/* -------------------------------------------------------------------------- */

export type OverviewStats = {
  workCount: number;
  recordCount: number;
  totalMinutes: number;
  averageRating: number | null;
  ratedCount: number;
};

export function getOverviewStats(): OverviewStats {
  const workCount = countWorks();

  // 「有看过日期就算数」：状态后来被豆瓣改回「想看」的记录，那天确实看过的历史仍然成立，
  // 不能因为状态变了就把这一笔从记录数和累计时长里抹掉。
  const rows = db
    .select({
      rating: viewRecord.rating,
      progressSeason: viewRecord.progressSeason,
      episodesWatched: viewRecord.episodesWatched,
      runtime: work.runtime,
      mediaType: work.mediaType,
      seasonsJson: work.seasonsJson,
    })
    .from(viewRecord)
    .leftJoin(work, eq(work.id, viewRecord.workId))
    .where(or(eq(viewRecord.status, "watched"), isNotNull(viewRecord.watchedAt)))
    .all();

  let totalMinutes = 0;
  let ratingSum = 0;
  let ratedCount = 0;

  for (const row of rows) {
    if (row.runtime && row.runtime > 0) {
      totalMinutes += row.runtime * episodeUnits(row);
    }
    if (row.rating != null) {
      ratingSum += row.rating;
      ratedCount += 1;
    }
  }

  return {
    workCount,
    recordCount: rows.length,
    totalMinutes,
    averageRating: ratedCount > 0 ? ratingSum / ratedCount : null,
    ratedCount,
  };
}

/**
 * 一条记录折算成多少「集」。电影恒为 1；
 * 剧集优先用显式填写的已看集数，其次用该季的总集数，都没有才算 1。
 */
function episodeUnits(row: {
  mediaType: string | null;
  progressSeason: number | null;
  episodesWatched: number | null;
  seasonsJson: string | null;
}): number {
  if (row.mediaType !== "tv") return 1;
  if (row.episodesWatched && row.episodesWatched > 0) return row.episodesWatched;
  if (row.progressSeason != null) {
    const season = parseSeasons(row.seasonsJson).find(
      (s) => s.seasonNumber === row.progressSeason,
    );
    if (season && season.episodeCount > 0) return season.episodeCount;
  }
  return 1;
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
