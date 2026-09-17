import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
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
  sort?: "recent" | "rating" | "title" | "year";
};

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
      watchCount: own.filter((r) => r.status === "watched").length,
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

export type WorkDetail = {
  work: Work;
  records: ViewRecordWithPlatform[];
  tags: Tag[];
};

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

  return { work: row, records, tags };
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

  const rows = db
    .select({
      rating: viewRecord.rating,
      episodesWatched: viewRecord.episodesWatched,
      runtime: work.runtime,
      mediaType: work.mediaType,
    })
    .from(viewRecord)
    .leftJoin(work, eq(work.id, viewRecord.workId))
    .all();

  let totalMinutes = 0;
  let ratingSum = 0;
  let ratedCount = 0;

  for (const row of rows) {
    if (row.runtime && row.runtime > 0) {
      // 剧集按已看集数估算，未记录集数时按单集时长算一次
      const units =
        row.mediaType === "tv" && row.episodesWatched && row.episodesWatched > 0
          ? row.episodesWatched
          : 1;
      totalMinutes += row.runtime * units;
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

export type RecentWatch = {
  record: ViewRecord;
  work: Work | null;
};

/** 最近观看：概览页的时间线 */
export function listRecentWatches(limit = 8): RecentWatch[] {
  return db
    .select({ record: viewRecord, work })
    .from(viewRecord)
    .leftJoin(work, eq(work.id, viewRecord.workId))
    .orderBy(desc(viewRecord.watchedAt), desc(viewRecord.id))
    .limit(limit)
    .all();
}
