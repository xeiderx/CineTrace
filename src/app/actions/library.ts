"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { platform, tag, viewRecord, work, workTag } from "@/db/schema";
import { getDefaultPlatform, posterUrl } from "@/lib/queries";
import { hasTmdbKey, searchTmdb, tmdbDetail } from "@/lib/tmdb";

export type FormState = { error?: string; ok?: boolean } | undefined;

/* -------------------------------------------------------------------------- */
/*                                    工具                                      */
/* -------------------------------------------------------------------------- */

/** 空字符串归一为 null，避免把 "" 写进日期列 */
function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function required(formData: FormData, key: string): string {
  return text(formData, key) ?? "";
}

/** 解析整数，非法或空返回 null */
function int(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** 解析逗号分隔的列表，写入 JSON 数组列 */
function list(formData: FormData, key: string): string[] {
  const raw = text(formData, key);
  if (!raw) return [];
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function refreshLibrary(workId?: number) {
  revalidatePath("/");
  revalidatePath("/library");
  if (workId != null) revalidatePath(`/library/${workId}`);
}

/* -------------------------------------------------------------------------- */
/*                                  作品管理                                    */
/* -------------------------------------------------------------------------- */

/** 手动新建作品。匹配失败或豆瓣没有的条目都可以从这里补录 */
export async function createWorkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const title = required(formData, "title");
  if (!title) return { error: "请填写片名" };

  const mediaType = required(formData, "mediaType") || "movie";
  if (mediaType !== "movie" && mediaType !== "tv") {
    return { error: "类型只能是电影或剧集" };
  }

  const inserted = db
    .insert(work)
    .values({
      title,
      mediaType,
      originalTitle: text(formData, "originalTitle"),
      year: int(formData, "year"),
      posterPath: text(formData, "posterPath"),
      overview: text(formData, "overview"),
      runtime: int(formData, "runtime"),
      seasonCount: int(formData, "seasonCount"),
      episodeCount: int(formData, "episodeCount"),
      releaseDate: text(formData, "releaseDate"),
      imdbId: text(formData, "imdbId"),
      doubanId: text(formData, "doubanId"),
      tmdbId: int(formData, "tmdbId"),
      genres: JSON.stringify(list(formData, "genres")),
      directors: JSON.stringify(list(formData, "directors")),
      cast: JSON.stringify(list(formData, "cast")),
      // 手动录入即视为人工确认，不参与自动匹配流程
      matchStatus: "manual",
      matchStrategy: "manual",
    })
    .returning({ id: work.id })
    .get();

  refreshLibrary(inserted.id);
  redirect(`/library/${inserted.id}`);
}

/** 编辑作品元数据。用于修正 TMDB 匹配错误后替换为正确条目 */
export async function updateWorkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  if (id == null) return { error: "缺少作品 ID" };

  const title = required(formData, "title");
  if (!title) return { error: "请填写片名" };

  db.update(work)
    .set({
      title,
      mediaType: required(formData, "mediaType") || "movie",
      originalTitle: text(formData, "originalTitle"),
      year: int(formData, "year"),
      posterPath: text(formData, "posterPath"),
      overview: text(formData, "overview"),
      runtime: int(formData, "runtime"),
      seasonCount: int(formData, "seasonCount"),
      episodeCount: int(formData, "episodeCount"),
      releaseDate: text(formData, "releaseDate"),
      imdbId: text(formData, "imdbId"),
      doubanId: text(formData, "doubanId"),
      tmdbId: int(formData, "tmdbId"),
      genres: JSON.stringify(list(formData, "genres")),
      directors: JSON.stringify(list(formData, "directors")),
      cast: JSON.stringify(list(formData, "cast")),
    })
    .where(eq(work.id, id))
    .run();

  refreshLibrary(id);
  return { ok: true };
}

export async function deleteWorkAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  // 观影流水的外键是 set null，这里显式清理，避免留下无主记录
  db.delete(viewRecord).where(eq(viewRecord.workId, id)).run();
  db.delete(work).where(eq(work.id, id)).run();

  refreshLibrary(id);
  redirect("/library");
}

/* -------------------------------------------------------------------------- */
/*                              手动重新匹配 TMDB                               */
/* -------------------------------------------------------------------------- */

export type SearchState =
  | { candidates?: TmdbCandidate[]; error?: string }
  | undefined;

/** 候选项。海报已拼成完整 URL，客户端组件不必知道 TMDB 图床规则 */
export type TmdbCandidate = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  year: number | null;
  poster: string | null;
};

/** 手动查询 TMDB 候选。输入片名或 TMDB ID 都可以 */
export async function searchTmdbAction(
  _prev: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const query = required(formData, "query");
  if (!query) return { error: "请输入片名或 TMDB ID" };
  if (!hasTmdbKey()) return { error: "请先在设置里填写 TMDB API Key" };

  const results = await searchTmdb(query);
  if (results.length === 0) {
    return { error: "没有找到匹配的条目，换个片名或直接填 TMDB ID 试试" };
  }

  return {
    candidates: results.map((r) => ({
      tmdbId: r.tmdbId,
      mediaType: r.mediaType,
      title: r.title || r.originalTitle || String(r.tmdbId),
      originalTitle: r.originalTitle,
      year: r.year,
      poster: posterUrl(r.posterPath, "w185"),
    })),
  };
}

export type MatchState = { ok?: boolean; message?: string; error?: string };

/**
 * 把作品重新绑定到指定的 TMDB 条目，并用详情接口一次性回填
 * 海报、简介、时长、分季结构等字段（手动匹配后无需再逐项填表）。
 */
export async function matchWorkToTmdbAction(
  formData: FormData,
): Promise<MatchState> {
  const id = int(formData, "id");
  const tmdbId = int(formData, "tmdbId");
  const mediaType = required(formData, "mediaType");
  if (id == null || tmdbId == null) return { error: "缺少作品或 TMDB ID" };
  if (mediaType !== "movie" && mediaType !== "tv") return { error: "类型只能是电影或剧集" };

  const current = db.select().from(work).where(eq(work.id, id)).get();
  if (!current) return { error: "作品不存在" };

  // 唯一索引 (mediaType, tmdbId)：同一 TMDB 条目不能挂到两部作品上
  const occupied = db
    .select({ id: work.id, title: work.title })
    .from(work)
    .where(and(eq(work.mediaType, mediaType), eq(work.tmdbId, tmdbId)))
    .get();
  if (occupied && occupied.id !== id) {
    return { error: `该条目已绑定到「${occupied.title}」，请先处理那一部` };
  }

  const detail = await tmdbDetail(mediaType, tmdbId);
  if (!detail) return { error: "拉取 TMDB 详情失败，请确认 ID 是否正确" };

  const isTv = mediaType === "tv";
  // 剧集年份取第一季首播年，与同步任务保持一致
  const firstSeasonYear = detail.seasons[0]?.airDate
    ? Number(detail.seasons[0].airDate.slice(0, 4)) || null
    : null;

  db.update(work)
    .set({
      mediaType,
      tmdbId,
      originalTitle: detail.originalTitle,
      posterPath: detail.posterPath,
      overview: detail.overview,
      runtime: detail.runtime,
      seasonCount: isTv ? detail.seasonCount ?? (detail.seasons.length || null) : null,
      episodeCount: isTv ? detail.episodeCount ?? null : null,
      seasonsJson: JSON.stringify(isTv ? detail.seasons : []),
      releaseDate: detail.releaseDate,
      imdbId: detail.imdbId,
      genres: JSON.stringify(detail.genres),
      directors: JSON.stringify(detail.directors),
      ...(isTv && firstSeasonYear != null ? { year: firstSeasonYear } : {}),
      // 人工确认的结果不参与后续自动匹配
      matchStatus: "manual",
      matchStrategy: "manual",
      metadataSyncedAt: new Date(),
    })
    .where(eq(work.id, id))
    .run();

  refreshLibrary(id);
  return { ok: true, message: "已重新绑定，元数据已更新" };
}

/** 为作品挂上标签。已存在的标签直接复用，否则新建 */
export async function attachTagAction(formData: FormData): Promise<void> {
  const workId = int(formData, "workId");
  const name = text(formData, "name");
  if (workId == null || !name) return;

  const existing = db.select().from(tag).where(eq(tag.name, name)).get();
  const tagId =
    existing?.id ??
    db.insert(tag).values({ name }).returning({ id: tag.id }).get().id;

  db.insert(workTag).values({ workId, tagId }).onConflictDoNothing().run();
  refreshLibrary(workId);
}

export async function detachTagAction(formData: FormData): Promise<void> {
  const workId = int(formData, "workId");
  const tagId = int(formData, "tagId");
  if (workId == null || tagId == null) return;

  db.delete(workTag)
    .where(and(eq(workTag.workId, workId), eq(workTag.tagId, tagId)))
    .run();
  refreshLibrary(workId);
}

/* -------------------------------------------------------------------------- */
/*                                 观影记录管理                                 */
/* -------------------------------------------------------------------------- */

/**
 * 新增一条观影流水。同一部作品看第二次即再插一行，
 * watchIndex 递增，天然表达二刷三刷。
 */
export async function createViewRecordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const workId = int(formData, "workId");
  if (workId == null) return { error: "缺少作品 ID" };

  const status = required(formData, "status") || "watched";
  const watchedAt = text(formData, "watchedAt");

  const maxRow = db
    .select({ value: sql<number>`coalesce(max(${viewRecord.watchIndex}), 0)` })
    .from(viewRecord)
    .where(eq(viewRecord.workId, workId))
    .get();

  db.insert(viewRecord)
    .values({
      workId,
      source: "manual",
      sourceKey: `manual:${randomUUID()}`,
      status,
      watchedAt,
      startedAt: text(formData, "startedAt"),
      finishedAt: text(formData, "finishedAt"),
      rating: int(formData, "rating"),
      comment: text(formData, "comment"),
      // 对话框里选择「默认」时不传 platformId，读取时回落到默认平台
      platformId: int(formData, "platformId"),
      watchIndex: (maxRow?.value ?? 0) + 1,
      progressSeason: int(formData, "progressSeason"),
      progressEpisode: int(formData, "progressEpisode"),
      episodesWatched: int(formData, "episodesWatched"),
    })
    .run();

  refreshLibrary(workId);
  return { ok: true };
}

export async function updateViewRecordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  if (id == null) return { error: "缺少记录 ID" };

  const row = db.select().from(viewRecord).where(eq(viewRecord.id, id)).get();
  if (!row) return { error: "记录不存在" };

  db.update(viewRecord)
    .set({
      status: required(formData, "status") || "watched",
      watchedAt: text(formData, "watchedAt"),
      startedAt: text(formData, "startedAt"),
      finishedAt: text(formData, "finishedAt"),
      rating: int(formData, "rating"),
      comment: text(formData, "comment"),
      platformId: int(formData, "platformId"),
      watchIndex: int(formData, "watchIndex") ?? row.watchIndex,
      progressSeason: int(formData, "progressSeason"),
      progressEpisode: int(formData, "progressEpisode"),
      episodesWatched: int(formData, "episodesWatched"),
    })
    .where(eq(viewRecord.id, id))
    .run();

  refreshLibrary(row.workId ?? undefined);
  return { ok: true };
}

export async function deleteViewRecordAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  const row = db.select().from(viewRecord).where(eq(viewRecord.id, id)).get();
  db.delete(viewRecord).where(eq(viewRecord.id, id)).run();

  refreshLibrary(row?.workId ?? undefined);
}

/**
 * 换绑：把观影流水改挂到另一部作品上。
 * 用于「豆瓣条目匹配错了，手动指到正确的 TMDB 作品」。
 */
export async function rebindViewRecordAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  const workId = int(formData, "workId");
  if (id == null || workId == null) return;

  const row = db.select().from(viewRecord).where(eq(viewRecord.id, id)).get();

  db.update(viewRecord).set({ workId }).where(eq(viewRecord.id, id)).run();

  refreshLibrary(row?.workId ?? undefined);
  refreshLibrary(workId);
}

/* -------------------------------------------------------------------------- */
/*                                 平台 / 标签                                  */
/* -------------------------------------------------------------------------- */

export async function savePlatformAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  const name = required(formData, "name");
  if (!name) return { error: "请填写平台名称" };

  const values = {
    name,
    icon: text(formData, "icon"),
    color: text(formData, "color"),
    sortOrder: int(formData, "sortOrder") ?? 0,
  };

  const duplicated = db
    .select()
    .from(platform)
    .where(eq(platform.name, name))
    .get();
  if (duplicated && duplicated.id !== id) return { error: "同名平台已存在" };

  if (id == null) {
    db.insert(platform).values(values).run();
  } else {
    db.update(platform).set(values).where(eq(platform.id, id)).run();
  }

  revalidatePath("/settings");
  revalidatePath("/library");
  return { ok: true };
}

export async function deletePlatformAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  // 平台被删后，引用它的观影记录回落为「默认平台」
  db.update(viewRecord)
    .set({ platformId: null })
    .where(eq(viewRecord.platformId, id))
    .run();
  db.delete(platform).where(eq(platform.id, id)).run();

  revalidatePath("/settings");
  revalidatePath("/library");
}

/** 设为默认平台。默认值同时只能有一个，故先全部置否 */
export async function setDefaultPlatformAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  db.update(platform).set({ isDefault: false }).run();
  db.update(platform).set({ isDefault: true }).where(eq(platform.id, id)).run();

  revalidatePath("/settings");
  revalidatePath("/library");
}

export async function createTagAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = required(formData, "name");
  if (!name) return { error: "请填写标签名称" };

  const existing = db.select().from(tag).where(eq(tag.name, name)).get();
  if (existing) return { error: "同名标签已存在" };

  db.insert(tag).values({ name, color: text(formData, "color") }).run();
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteTagAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  db.delete(tag).where(eq(tag.id, id)).run();
  revalidatePath("/settings");
  revalidatePath("/library");
}

/** 当前默认平台，供表单展示「默认」选项的文案 */
export async function currentDefaultPlatformName(): Promise<string | null> {
  return getDefaultPlatform()?.name ?? null;
}
