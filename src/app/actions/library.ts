"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  collectionItem,
  person,
  platform,
  sourceChannel,
  tag,
  viewEpisode,
  viewRecord,
  viewRecordTag,
  work,
  type Person,
  type ViewRecord,
} from "@/db/schema";
import {
  getDefaultPlatform,
  listWorksByCastId,
  parseSeasons,
  posterUrl,
} from "@/lib/queries";
import {
  VIEW_RECORD_FIELD_LABELS,
  VIEW_RECORD_FIELDS,
  VIEW_STATUS_ORDER,
  mergeCast,
  parseCast,
  viewStatusLabel,
  type ViewRecordField,
} from "@/lib/labels";
import { parseManualFields, todayIso } from "@/lib/watch-progress";
import {
  hasTmdbKey,
  searchTmdb,
  tmdbDetail,
  tmdbPerson,
  type TmdbDetail,
} from "@/lib/tmdb";

export type FormState = { error?: string; ok?: boolean; message?: string } | undefined;

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
  // 逐集标记会改变「追剧」页的在看列表与进度，一并刷新
  revalidatePath("/watching");
  if (workId != null) revalidatePath(`/library/${workId}`);
}

/* ------------------------------- 手动锁定字段 ------------------------------- */

/**
 * 参与锁定判断的字段值。
 *
 * 类型按各列的真实类型写：如果统一放宽成 `string | number | null`，
 * `status` 就只剩这个宽类型，没法直接交给 drizzle 的 `set()`。
 * 各键齐全，因此仍可用 `ViewRecordField` 联合键去索引。
 */
type ViewRecordFieldValues = {
  status: string;
  watchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  comment: string | null;
  progressSeason: number | null;
};

/** 归一化比较：数字列与文本列都按字符串比，避免 3 与 "3" 被判成不同值 */
function sameValue(a: string | number | null, b: string | number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return `${a}` === `${b}`;
}

/** 找出这次编辑真的改动过的字段——只有这些才该被锁上 */
function changedFields(
  before: ViewRecordFieldValues,
  after: ViewRecordFieldValues,
): ViewRecordField[] {
  return VIEW_RECORD_FIELDS.filter((field) => !sameValue(before[field], after[field]));
}

/** 表单传来的字段名过滤成合法字段，忽略不认识的值 */
function toViewRecordFields(names: string[]): ViewRecordField[] {
  return names.filter((name): name is ViewRecordField =>
    (VIEW_RECORD_FIELDS as string[]).includes(name),
  );
}

/** 取出参与锁定判断的字段当前值 */
function fieldValues(row: ViewRecord): ViewRecordFieldValues {
  return {
    status: row.status,
    watchedAt: row.watchedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    rating: row.rating,
    comment: row.comment,
    progressSeason: row.progressSeason,
  };
}

/**
 * 算出这次保存后该有哪些字段被锁定。
 *
 * 顺序是有意的：先锁定「这次改动过的」，再移除「用户点名要恢复跟随豆瓣的」。
 * 两者重叠时以解锁为准——用户既改了值又说要跟随豆瓣，只能理解成
 * 「改成豆瓣那个值」，所以不该锁。
 */
function nextLockedFields(
  current: string | null,
  changed: ViewRecordField[],
  unlocked: ViewRecordField[],
): string {
  const locked = new Set(parseManualFields(current));
  for (const field of changed) locked.add(field);
  for (const field of unlocked) locked.delete(field);
  return JSON.stringify([...locked]);
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
      countries: JSON.stringify(list(formData, "countries")),
      directors: JSON.stringify(list(formData, "directors")),
      cast: JSON.stringify(mergeCast([], list(formData, "cast"))),
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

  const current = db.select().from(work).where(eq(work.id, id)).get();

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
      countries: JSON.stringify(list(formData, "countries")),
      directors: JSON.stringify(list(formData, "directors")),
      // 表单只输入姓名，头像与 person id 从旧记录按姓名贴回，避免编辑时被冲掉
      cast: JSON.stringify(mergeCast(parseCast(current?.cast), list(formData, "cast"))),
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

/**
 * 档案库列表页的删除。与详情页的 deleteWorkAction 只差一件事：不 redirect。
 *
 * 列表页的筛选条件与页码都在 URL 上，redirect("/library") 会把它们一并清掉，
 * 删完一条就跳回未筛选的第一页。这里只做 revalidatePath，
 * 当前路由带着原有的 query 重新渲染，筛选与页码自然保留。
 */
export async function deleteWorkInListAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  db.delete(viewRecord).where(eq(viewRecord.workId, id)).run();
  db.delete(work).where(eq(work.id, id)).run();

  refreshLibrary(id);
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

export type MatchState = {
  ok?: boolean;
  message?: string;
  error?: string;
  /**
   * 目标 TMDB 条目已被别的作品占用（同一部剧在库里占了两行）。
   * 回带占用方信息，前端据此提供「合并」确认，而不是让用户干瞪眼。
   */
  conflict?: { workId: number; title: string };
  /** 合并完成后的存留作品：当前详情页已被删掉，客户端要跳到它 */
  merged?: { workId: number; title: string };
};

/** 新建成功时带回 id，客户端据此跳到新作品的详情页 */
export type CreateWorkState = MatchState & { workId?: number };

/**
 * 把 TMDB 详情整理成可写入 work 的字段。
 *
 * 「重新匹配已存在的作品」与「搜索后新建作品」两条路径的落库内容完全一致，
 * 差别只在写的是 update 还是 insert，所以字段映射放这里共用，避免两处走偏。
 */
function tmdbValues(
  mediaType: "movie" | "tv",
  tmdbId: number,
  detail: TmdbDetail,
): Omit<Partial<typeof work.$inferInsert>, "mediaType"> & { mediaType: "movie" | "tv" } {
  const isTv = mediaType === "tv";
  // 剧集年份取第一季首播年，与同步任务保持一致
  const firstSeasonYear = detail.seasons[0]?.airDate
    ? Number(detail.seasons[0].airDate.slice(0, 4)) || null
    : null;

  return {
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
    countries: JSON.stringify(detail.countries),
    directors: JSON.stringify(detail.directors),
    cast: JSON.stringify(detail.cast),
    ...(isTv && firstSeasonYear != null ? { year: firstSeasonYear } : {}),
    // 人工选择的条目不再参与后续自动匹配
    matchStatus: "manual",
    matchStrategy: "manual",
    metadataSyncedAt: new Date(),
  };
}

/**
 * 手动搜 TMDB 后新建作品。
 *
 * 与「手动添加」表单的区别：这里只挑一个候选条目，
 * 海报、简介、时长、分季、国家、主演全部由详情接口一次性带回，
 * 不必逐项填表。冷门片 TMDB 也没有时，仍可用原表单兜底录入。
 */
export async function createWorkFromTmdbAction(
  formData: FormData,
): Promise<CreateWorkState> {
  const tmdbId = int(formData, "tmdbId");
  const mediaType = required(formData, "mediaType");
  if (tmdbId == null) return { error: "缺少 TMDB ID" };
  if (mediaType !== "movie" && mediaType !== "tv") return { error: "类型只能是电影或剧集" };

  // 唯一索引 (mediaType, tmdbId)：同一 TMDB 条目不能挂到两部作品上
  const occupied = db
    .select({ id: work.id, title: work.title })
    .from(work)
    .where(and(eq(work.mediaType, mediaType), eq(work.tmdbId, tmdbId)))
    .get();
  if (occupied) {
    return { error: `库里已有「${occupied.title}」，直接打开它就行` };
  }

  const detail = await tmdbDetail(mediaType, tmdbId);
  if (!detail) return { error: "拉取 TMDB 详情失败，请确认 ID 是否正确" };

  const values = tmdbValues(mediaType, tmdbId, detail);
  // 详情接口没有本地化标题，用搜索候选带过来的片名；极端情况下才退回 TMDB ID
  const title = text(formData, "title") ?? detail.originalTitle ?? `TMDB ${tmdbId}`;

  const inserted = db
    .insert(work)
    .values({ ...values, title })
    .returning({ id: work.id })
    .get();

  refreshLibrary(inserted.id);
  return { ok: true, workId: inserted.id, message: `已添加《${title}》` };
}

/**
 * 把重复的作品行并进已有的那一行，然后删掉它。
 *
 * 多季剧在库里占两行时（豆瓣每季一个条目，各季各自匹配就可能留下重复），
 * 重新绑定时会撞上 (mediaType, tmdbId) 唯一索引，此时该做的是合并不是报错。
 * 观影记录是 `onDelete: set null`，不显式改挂就会变成「未关联作品」；
 * 片单是 `onDelete: cascade`，得先复制过去再删，否则跟着重复行一起没了。
 *
 * 标签不需要单独处理：它挂在观影流水上，上面的改挂把流水整条迁过去，
 * 标签随流水保留，无需搬运。
 */
function mergeWorkInto(sourceId: number, target: { id: number; title: string }): MatchState {
  db.transaction((tx) => {
    tx.update(viewRecord).set({ workId: target.id }).where(eq(viewRecord.workId, sourceId)).run();

    const items = tx
      .select({
        collectionId: collectionItem.collectionId,
        sortOrder: collectionItem.sortOrder,
        note: collectionItem.note,
      })
      .from(collectionItem)
      .where(eq(collectionItem.workId, sourceId))
      .all();
    for (const item of items) {
      tx.insert(collectionItem)
        .values({ ...item, workId: target.id })
        .onConflictDoNothing()
        .run();
    }

    // 逐集记录也是 cascade，但 `(workId, watchIndex, seasonNumber, episodeNumber)`
    // 上有唯一索引，直接 update workId 会撞上目标行，只能先复制再让删源带走原件。
    const episodes = tx
      .select({
        watchIndex: viewEpisode.watchIndex,
        seasonNumber: viewEpisode.seasonNumber,
        episodeNumber: viewEpisode.episodeNumber,
        watchedAt: viewEpisode.watchedAt,
      })
      .from(viewEpisode)
      .where(eq(viewEpisode.workId, sourceId))
      .all();
    for (const episode of episodes) {
      tx.insert(viewEpisode)
        .values({ ...episode, workId: target.id })
        .onConflictDoNothing()
        .run();
    }

    tx.delete(work).where(eq(work.id, sourceId)).run();
  });

  // 当前详情页对应的作品已经被删了，客户端要跳到合并后的那一部
  refreshLibrary(target.id);
  return {
    ok: true,
    message: `已合并到《${target.title}》，观影记录一并转移`,
    merged: { workId: target.id, title: target.title },
  };
}

/**
 * 把作品重新绑定到指定的 TMDB 条目，并用详情接口一次性回填
 * 海报、简介、时长、分季结构等字段（手动匹配后无需再逐项填表）。
 *
 * 目标条目已被别的作品占用时（同一部剧在库里占了两行）不直接报错，
 * 而是把占用方回带给前端，用户确认后再带 `merge=1` 调一次本接口完成合并。
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
    if (text(formData, "merge") !== "1") {
      return {
        error: `该条目已绑定到「${occupied.title}」，可以把这一条并过去`,
        conflict: { workId: occupied.id, title: occupied.title },
      };
    }
    return mergeWorkInto(id, occupied);
  }

  const detail = await tmdbDetail(mediaType, tmdbId);
  if (!detail) return { error: "拉取 TMDB 详情失败，请确认 ID 是否正确" };

  db.update(work)
    .set(tmdbValues(mediaType, tmdbId, detail))
    .where(eq(work.id, id))
    .run();

  refreshLibrary(id);
  return { ok: true, message: "已重新绑定，元数据已更新" };
}

/* -------------------------------------------------------------------------- */
/*                                 演员生平                                     */
/* -------------------------------------------------------------------------- */

/** 演员在库内参演的一部作品，海报地址已在服务端拼好 */
export type PersonWorkItem = {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

export type PersonProfile = {
  name: string;
  biography: string | null;
  birthday: string | null;
  placeOfBirth: string | null;
  /** 这份资料的抓取日期，ISO 文本。界面据此提示新旧 */
  updatedAt: string;
};

/**
 * 简介与库内作品分开返回：作品查的是本地库，
 * 就算 TMDB 取不到简介（缺 Key、超时），参演作品照样能看。
 */
export type PersonDetailResult = {
  profile: PersonProfile | null;
  /** 取简介失败的原因；成功时为 null */
  error: string | null;
  works: PersonWorkItem[];
};

/** 简介缓存有效期：半年。生平几乎不变，过期只是防 TMDB 上偶尔被修正的错漏 */
const PERSON_TTL_MS = 182 * 24 * 60 * 60 * 1000;

/** 库内参演作品，顺带把海报地址拼好——客户端组件拿不到 posterUrl */
function personWorks(personId: number): PersonWorkItem[] {
  return listWorksByCastId(personId).map((w) => ({
    ...w,
    posterUrl: posterUrl(w.posterPath, "w185"),
  }));
}

function toProfile(row: Person): PersonProfile {
  return {
    name: row.name,
    biography: row.biography,
    birthday: row.birthday,
    placeOfBirth: row.placeOfBirth,
    updatedAt: row.fetchedAt?.toISOString() ?? "",
  };
}

/**
 * 取演员生平，供详情页点击头像时调用。
 *
 * 先查 person 表——同一个演员在多部作品里出现很常见，
 * 缓存住就不必每次点开都发一次请求。未命中或超过半年才走 TMDB，
 * 拉到的结果顺手落库。
 *
 * `force` 为手动「重新获取」，跳过缓存直接重拉。
 */
export async function getPersonProfileAction(
  personId: number,
  force = false,
): Promise<PersonDetailResult> {
  if (!Number.isInteger(personId) || personId <= 0) {
    return { profile: null, error: "无效的演员 ID", works: [] };
  }

  const works = personWorks(personId);
  const cached = db.select().from(person).where(eq(person.tmdbPersonId, personId)).get();

  const fresh = cached?.fetchedAt && Date.now() - cached.fetchedAt.getTime() < PERSON_TTL_MS;
  if (cached && fresh && !force) {
    return { profile: toProfile(cached), error: null, works };
  }

  // 已有缓存时，任何失败都退化成「照旧展示」——总好过把抓来的资料吞掉
  const fallback = cached
    ? { profile: toProfile(cached), error: null, works }
    : null;

  if (!hasTmdbKey()) {
    return fallback ?? { profile: null, error: "未配置 TMDB API Key，无法获取简介", works };
  }

  const fetched = await tmdbPerson(personId);
  if (!fetched) {
    return fallback ?? { profile: null, error: "获取简介失败，请稍后重试", works };
  }

  const now = new Date();
  const values = {
    name: fetched.name,
    biography: fetched.biography,
    birthday: fetched.birthday,
    placeOfBirth: fetched.placeOfBirth,
    fetchedAt: now,
  };

  db.insert(person)
    .values({ tmdbPersonId: personId, ...values })
    .onConflictDoUpdate({ target: person.tmdbPersonId, set: values })
    .run();

  return {
    profile: {
      name: fetched.name,
      biography: fetched.biography,
      birthday: fetched.birthday,
      placeOfBirth: fetched.placeOfBirth,
      updatedAt: now.toISOString(),
    },
    error: null,
    works,
  };
}

/** 流水所属的作品 id，用于决定该刷新哪个详情页；流水未关联作品时为 undefined */
function viewRecordWorkId(viewRecordId: number): number | undefined {
  return (
    db
      .select({ workId: viewRecord.workId })
      .from(viewRecord)
      .where(eq(viewRecord.id, viewRecordId))
      .get()?.workId ?? undefined
  );
}

/**
 * 把标签名挂到指定观影流水上，同名标签复用已有记录，否则新建。
 *
 * 用于「新建流水时同一次提交内挂标签」：那时流水刚拿到 id，表单里只有标签名。
 * 新标签不带颜色，颜色统一在标签管理页调整。
 */
function attachTagNames(viewRecordId: number, names: string[]): void {
  for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
    const existing = db.select().from(tag).where(eq(tag.name, name)).get();
    const tagId =
      existing?.id ??
      db.insert(tag).values({ name }).returning({ id: tag.id }).get().id;
    db.insert(viewRecordTag).values({ viewRecordId, tagId }).onConflictDoNothing().run();
  }
}

/**
 * 为某一次观看挂上标签。已存在的标签直接复用，否则新建。
 *
 * 标签挂在观影流水上、不属于作品：同一部片一刷觉得「剧情不错」、二刷觉得
 * 「不好看」，两个判断属于不同的观看行为，各挂各的才不会混成一堆。
 *
 * 同名标签直接复用现有记录，**不覆盖它已有的颜色**：
 * 颜色属于标签本体的属性，在标签管理页统一调整，
 * 这里顺手改色会让别处同标签的记录跟着变色。
 */
export async function attachTagAction(formData: FormData): Promise<void> {
  const viewRecordId = int(formData, "viewRecordId");
  const name = text(formData, "name");
  if (viewRecordId == null || !name) return;

  const color = text(formData, "color");
  const existing = db.select().from(tag).where(eq(tag.name, name)).get();
  const tagId =
    existing?.id ??
    db.insert(tag).values({ name, color }).returning({ id: tag.id }).get().id;

  db.insert(viewRecordTag)
    .values({ viewRecordId, tagId })
    .onConflictDoNothing()
    .run();
  refreshLibrary(viewRecordWorkId(viewRecordId));
}

export async function detachTagAction(formData: FormData): Promise<void> {
  const viewRecordId = int(formData, "viewRecordId");
  const tagId = int(formData, "tagId");
  if (viewRecordId == null || tagId == null) return;

  db.delete(viewRecordTag)
    .where(
      and(
        eq(viewRecordTag.viewRecordId, viewRecordId),
        eq(viewRecordTag.tagId, tagId),
      ),
    )
    .run();
  refreshLibrary(viewRecordWorkId(viewRecordId));
}

/**
 * 只改某条流水的来源渠道。
 *
 * 详情页顶部与编辑弹窗里的来源渠道都作用于「最新一次观看」，那里的流水
 * 已经存在，没必要走 updateViewRecordAction 整表回填一遍——那条路径会重算
 * 手动锁定字段、还会顺带覆盖状态与日期，改动面太大。
 *
 * 表单里传 NO_CHANNEL 哨兵时 int() 得到 null，正好表示「未指定」。
 */
export async function updateRecordSourceChannelAction(
  formData: FormData,
): Promise<void> {
  const viewRecordId = int(formData, "viewRecordId");
  if (viewRecordId == null) return;

  db.update(viewRecord)
    .set({ sourceChannelId: int(formData, "sourceChannelId") })
    .where(eq(viewRecord.id, viewRecordId))
    .run();
  refreshLibrary(viewRecordWorkId(viewRecordId));
}

/* -------------------------------------------------------------------------- */
/*                                 观影记录管理                                 */
/* -------------------------------------------------------------------------- */

/**
 * 校验手填的集数是否超过该季实际集数。
 *
 * `progressEpisode` / `episodesWatched` 是没有逐集记录时的兜底展示值，
 * 填超了会把进度条算到 100% 以上，所以按 `work.seasonsJson` 里的集数卡住。
 * 季号未知（未标记季，或该季不在 TMDB 列表里）时退化为逐集标记的同一个上限，
 * 只做防呆，不误伤手动补录的老剧。
 */
function validateEpisodeProgress(
  seasonNumber: number | null,
  progressEpisode: number | null,
  episodesWatched: number | null,
  seasonsJson: string | null | undefined,
): string | null {
  const season =
    seasonNumber == null
      ? null
      : (parseSeasons(seasonsJson).find((s) => s.seasonNumber === seasonNumber) ??
        null);
  const cap =
    season && season.episodeCount > 0 ? season.episodeCount : MAX_BATCH_EPISODES;
  const seasonLabel = seasonNumber == null ? "该剧" : `第 ${seasonNumber} 季`;

  if (progressEpisode != null && (progressEpisode < 0 || progressEpisode > cap)) {
    return `${seasonLabel}共 ${cap} 集，集号应在 0–${cap} 之间`;
  }
  if (episodesWatched != null && (episodesWatched < 0 || episodesWatched > cap)) {
    return `${seasonLabel}共 ${cap} 集，累计已看不能超过 ${cap}`;
  }
  return null;
}

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

  const progressSeason = int(formData, "progressSeason");
  const progressEpisode = int(formData, "progressEpisode");
  const episodesWatched = int(formData, "episodesWatched");

  const workRow = db
    .select({ seasonsJson: work.seasonsJson })
    .from(work)
    .where(eq(work.id, workId))
    .get();
  const progressError = validateEpisodeProgress(
    progressSeason,
    progressEpisode,
    episodesWatched,
    workRow?.seasonsJson,
  );
  if (progressError) return { error: progressError };

  const maxRow = db
    .select({ value: sql<number>`coalesce(max(${viewRecord.watchIndex}), 0)` })
    .from(viewRecord)
    .where(eq(viewRecord.workId, workId))
    .get();

  const inserted = db
    .insert(viewRecord)
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
      // 来源渠道可以不选，不选即 null
      sourceChannelId: int(formData, "sourceChannelId"),
      watchIndex: (maxRow?.value ?? 0) + 1,
      progressSeason,
      progressEpisode,
      episodesWatched,
    })
    .returning({ id: viewRecord.id })
    .get();

  // 标签挂在流水上，新建时这条流水还没有 id，没法像编辑那样即时挂载，
  // 只能等落库拿到 id 后在同一次提交里补写关联。
  attachTagNames(inserted.id, formData.getAll("tagNames").map(String));

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

  const status = required(formData, "status") || "watched";

  // progressSeason 用 NO_SEASON 哨兵表示「未标记」，要靠它把已有的季号清掉，
  // 所以不能简单套 `?? row.progressSeason`——哨兵要落成 null。
  // 表单没带这个键（如从别处触发的部分更新）才保留原值。
  const hasSeasonField = formData.has("progressSeason");
  const seasonRaw = hasSeasonField ? int(formData, "progressSeason") : row.progressSeason;

  const values: ViewRecordFieldValues = {
    status,
    watchedAt: text(formData, "watchedAt"),
    startedAt: text(formData, "startedAt"),
    finishedAt: text(formData, "finishedAt"),
    rating: int(formData, "rating"),
    comment: text(formData, "comment"),
    progressSeason: seasonRaw,
  };

  const changed = changedFields(fieldValues(row), values);
  const unlocked = toViewRecordFields(formData.getAll("unlockFields").map(String));

  const progressEpisode = formData.has("progressEpisode")
    ? int(formData, "progressEpisode")
    : row.progressEpisode;
  const episodesWatched = formData.has("episodesWatched")
    ? int(formData, "episodesWatched")
    : row.episodesWatched;

  const workRow = db
    .select({ seasonsJson: work.seasonsJson })
    .from(work)
    .where(eq(work.id, row.workId ?? 0))
    .get();
  const progressError = validateEpisodeProgress(
    seasonRaw,
    progressEpisode,
    episodesWatched,
    workRow?.seasonsJson,
  );
  if (progressError) return { error: progressError };

  // 与追剧页的状态菜单同一处理：把「看过」改成别的状态前，先把这一季固化成
  // 逐集记录，否则该季会失去「已完成」的判据，进度凭空归零。
  // 这里用改之前的 progressSeason——「看过」对应的是修改前那一季的事实。
  if (row.status === "watched" && status !== "watched") {
    freezeWatchedSeason(row, row.finishedAt ?? row.watchedAt ?? todayIso());
  }

  db.update(viewRecord)
    .set({
      ...values,
      platformId: int(formData, "platformId"),
      // 与 platformId 同法：哨兵值经 int() 落成 null，表示「未指定来源渠道」
      sourceChannelId: int(formData, "sourceChannelId"),
      watchIndex: int(formData, "watchIndex") ?? row.watchIndex,
      // 集数进度是逐集标记落地前的兜底展示值，缺值就保留原样；
      // 0 是合法值（表示「一集没看」），所以只在键不存在时才兜底。
      progressEpisode,
      episodesWatched,
      manualFieldsJson: nextLockedFields(row.manualFieldsJson, changed, unlocked),
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
/*                                 逐集进度标记                                 */
/* -------------------------------------------------------------------------- */

/**
 * 逐集标记统一落在第 1 刷。
 *
 * 进度回答的是「这部剧我看过哪些集」，与刷次无关——`lib/queries.ts` 读逐集记录
 * 时也不按 watchIndex 过滤。固定写第 1 刷，读写口径才是同一个，不会出现
 * 「标记时记在第 2 刷、算进度时只看第 1 刷」这种自相矛盾。
 */
const PROGRESS_WATCH_INDEX = 1;

/** 一次补齐的集数上限。防呆用，正常剧集远小于这个数 */
const MAX_BATCH_EPISODES = 1000;

/** 面板上的操作目标：一部作品的某一季 */
function episodeTarget(
  formData: FormData,
): { workId: number; seasonNumber: number } | null {
  const workId = int(formData, "workId");
  const seasonNumber = int(formData, "seasonNumber");
  if (workId == null || seasonNumber == null || seasonNumber < 0) return null;
  return { workId, seasonNumber };
}

/**
 * 把某一季的进度落成「已看第 1..last 集」。
 *
 * 这是进度面板的主操作：点集号网格里的第 K 格就是「看到第 K 集」，
 * 「整季看完」传最后一集，「标记下一集」传 `lastWatched + 1`。
 * 目标进度之上的集号会被清掉——点第 K 格要的是「就停在这里」，
 * 留着更大的集号会立刻把进度又顶回去。
 *
 * 已存在的记录保留自己的日期，只给这次新补的集号写日期：用户选 9 月 1 日
 * 去补第 3、4 集，不该把 6 月就标好的第 1、2 集改成 9 月 1 日。
 */
function setSeasonProgress(
  workId: number,
  seasonNumber: number,
  last: number,
  watchedAt: string,
): void {
  db.transaction((tx) => {
    const existing = tx
      .select({
        id: viewEpisode.id,
        episodeNumber: viewEpisode.episodeNumber,
        watchedAt: viewEpisode.watchedAt,
      })
      .from(viewEpisode)
      .where(
        and(
          eq(viewEpisode.workId, workId),
          eq(viewEpisode.watchIndex, PROGRESS_WATCH_INDEX),
          eq(viewEpisode.seasonNumber, seasonNumber),
        ),
      )
      .all();

    const byEpisode = new Map(existing.map((row) => [row.episodeNumber, row]));

    for (const row of existing) {
      if (row.episodeNumber > last) {
        tx.delete(viewEpisode).where(eq(viewEpisode.id, row.id)).run();
      }
    }

    for (let episodeNumber = 1; episodeNumber <= last; episodeNumber += 1) {
      const row = byEpisode.get(episodeNumber);
      if (!row) {
        tx.insert(viewEpisode)
          .values({
            workId,
            watchIndex: PROGRESS_WATCH_INDEX,
            seasonNumber,
            episodeNumber,
            watchedAt,
          })
          .run();
      } else if (row.watchedAt == null) {
        tx.update(viewEpisode)
          .set({ watchedAt })
          .where(eq(viewEpisode.id, row.id))
          .run();
      }
    }
  });
}

/**
 * 把某一季的进度设成「已看第 1..last 集」。`lastEpisode = 0` 即清空这一季。
 *
 * 面板没传日期时用今天（`todayIso()` 取本地时区，不用 UTC，
 * 否则清晨标的会被记到昨天）。
 */
export async function setSeasonProgressAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const target = episodeTarget(formData);
  if (!target) return { error: "缺少作品或季号" };

  const lastEpisode = int(formData, "lastEpisode");
  if (lastEpisode == null || lastEpisode < 0) return { error: "集号不合法" };
  if (lastEpisode > MAX_BATCH_EPISODES) {
    return { error: `一次最多标记 ${MAX_BATCH_EPISODES} 集` };
  }

  const watchedAt = text(formData, "watchedAt") ?? todayIso();

  setSeasonProgress(target.workId, target.seasonNumber, lastEpisode, watchedAt);
  refreshLibrary(target.workId);
  return {
    ok: true,
    message:
      lastEpisode === 0
        ? `已清空第 ${target.seasonNumber} 季的观看进度`
        : `第 ${target.seasonNumber} 季已记到第 ${lastEpisode} 集`,
  };
}

/** 标记单独某一集。跳着看、补看漏掉的一集走这里，不牵动这一季的其他集 */
export async function saveEpisodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const target = episodeTarget(formData);
  if (!target) return { error: "缺少作品或季号" };

  const episodeNumber = int(formData, "episodeNumber");
  if (episodeNumber == null || episodeNumber < 1) return { error: "集号不合法" };

  const watchedAt = text(formData, "watchedAt") ?? todayIso();

  db.insert(viewEpisode)
    .values({
      workId: target.workId,
      watchIndex: PROGRESS_WATCH_INDEX,
      seasonNumber: target.seasonNumber,
      episodeNumber,
      watchedAt,
    })
    .onConflictDoUpdate({
      target: [
        viewEpisode.workId,
        viewEpisode.watchIndex,
        viewEpisode.seasonNumber,
        viewEpisode.episodeNumber,
      ],
      set: { watchedAt },
    })
    .run();

  refreshLibrary(target.workId);
  return {
    ok: true,
    message: `第 ${target.seasonNumber} 季第 ${episodeNumber} 集已标记为看过`,
  };
}

/** 撤销单独某一集。与 saveEpisodeAction 相对，供集号网格里的「取消这一集」用 */
export async function removeEpisodeAction(formData: FormData): Promise<void> {
  const target = episodeTarget(formData);
  if (!target) return;

  const episodeNumber = int(formData, "episodeNumber");
  if (episodeNumber == null) return;

  db.delete(viewEpisode)
    .where(
      and(
        eq(viewEpisode.workId, target.workId),
        eq(viewEpisode.watchIndex, PROGRESS_WATCH_INDEX),
        eq(viewEpisode.seasonNumber, target.seasonNumber),
        eq(viewEpisode.episodeNumber, episodeNumber),
      ),
    )
    .run();

  refreshLibrary(target.workId);
}

/**
 * 让指定字段重新跟随豆瓣。
 *
 * 只把字段名从锁定名单里移除，不立刻去抓豆瓣：同步任务有自己的作息窗口与节流，
 * 详情页上临时发一次请求既慢又容易触发风控。移除后下一轮同步会重新写入豆瓣的值。
 */
export async function unlockViewRecordFieldsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  if (id == null) return { error: "缺少记录 ID" };

  const row = db.select().from(viewRecord).where(eq(viewRecord.id, id)).get();
  if (!row) return { error: "记录不存在" };

  const fields = toViewRecordFields(formData.getAll("fields").map(String));
  if (fields.length === 0) return { error: "没有指定要恢复的字段" };

  db.update(viewRecord)
    .set({ manualFieldsJson: nextLockedFields(row.manualFieldsJson, [], fields) })
    .where(eq(viewRecord.id, id))
    .run();

  refreshLibrary(row.workId ?? undefined);
  return {
    ok: true,
    message: `已恢复跟随豆瓣：${fields.map((f) => VIEW_RECORD_FIELD_LABELS[f]).join("、")}`,
  };
}

/**
 * 把流水上「这一季看完了」的事实固化成逐集记录。
 *
 * 季级的完成判据读的是该季最近一条流水的 status（见 `buildShowProgress` 的
 * `doubanCompleted`）。用户把某条「看过」改成弃看/搁置/想看后，这个判据立刻
 * 变假，该季进度就回退到逐集数据——而豆瓣同步从不落逐集记录，于是整季进度
 * 凭空归零。改状态之前先把这一季物化成逐集记录，事实就落在真正的数据源上，
 * 之后无论状态怎么改，进度都还在。
 *
 * 落到哪一季看流水上的 `progressSeason`；单季剧的标题里没有季号，流水上也就
 * 没有这一列，此时整部剧就是那一季。seasonsJson 里查不到这一季（TMDB 没匹配上、
 * 季结构为空）时不猜集数——宁可不物化，也不要写进一批错误的集号。
 */
function freezeWatchedSeason(row: ViewRecord, watchedAt: string): void {
  if (row.workId == null) return;

  const target = db
    .select({ mediaType: work.mediaType, seasonsJson: work.seasonsJson })
    .from(work)
    .where(eq(work.id, row.workId))
    .get();
  if (!target || target.mediaType !== "tv") return;

  const seasons = parseSeasons(target.seasonsJson);
  const seasonNumber =
    row.progressSeason ?? (seasons.length === 1 ? seasons[0].seasonNumber : null);
  if (seasonNumber == null) return;

  const episodeCount = seasons.find(
    (s) => s.seasonNumber === seasonNumber,
  )?.episodeCount;
  if (episodeCount == null || episodeCount <= 0 || episodeCount > MAX_BATCH_EPISODES) {
    return;
  }

  setSeasonProgress(row.workId, seasonNumber, episodeCount, watchedAt);
}

/**
 * 只改观看状态，不动其他字段。
 *
 * 不能复用 updateViewRecordAction：那个表单提交什么就写什么，缺的字段会被清成
 * null，追剧页上点一下「搁置」不该顺手抹掉日期和短评。这里只碰 status，
 * 并把它记进锁定名单，免得下一轮豆瓣同步又按列表改回去。
 */
export async function setViewRecordStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  if (id == null) return { error: "缺少记录 ID" };

  const status = required(formData, "status");
  if (!(VIEW_STATUS_ORDER as string[]).includes(status)) {
    return { error: "未知的观看状态" };
  }

  const row = db.select().from(viewRecord).where(eq(viewRecord.id, id)).get();
  if (!row) return { error: "记录不存在" };
  if (row.status === status) return { ok: true };

  // 改出「看过」前，先把这条流水代表的整季固化成逐集记录，否则该季进度归零
  if (row.status === "watched") {
    freezeWatchedSeason(row, row.finishedAt ?? row.watchedAt ?? todayIso());
  }

  db.update(viewRecord)
    .set({
      status,
      manualFieldsJson: nextLockedFields(row.manualFieldsJson, ["status"], []),
    })
    .where(eq(viewRecord.id, id))
    .run();

  refreshLibrary(row.workId ?? undefined);
  return { ok: true, message: `已改为${viewStatusLabel(status)}` };
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

/**
 * 修改标签的名称与颜色。
 *
 * 重名检查要排除自身，否则只改颜色、名称不动时会被自己挡住。
 * 颜色留空表示「清除颜色」，回落成中性样式。
 */
export async function updateTagAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  if (id == null) return { error: "标签不存在" };

  const name = required(formData, "name");
  if (!name) return { error: "请填写标签名称" };

  const existing = db.select().from(tag).where(eq(tag.name, name)).get();
  if (existing && existing.id !== id) return { error: "同名标签已存在" };

  db.update(tag)
    .set({ name, color: text(formData, "color") })
    .where(eq(tag.id, id))
    .run();

  revalidatePath("/settings");
  revalidatePath("/library");
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

/* -------------------------------------------------------------------------- */
/*                                 来源渠道                                     */
/* -------------------------------------------------------------------------- */

/**
 * 图片 data URL 允许的 MIME。客户端已压缩到 128px，这里只做格式与体积兜底。
 *
 * 也放行 SVG：预置的爱奇艺/优酷/腾讯视频图标就是内联 SVG，用户编辑这些渠道时
 * 会把整串原样提交回来。SVG 放在 `<img src>` 里不执行脚本，风险与位图等同。
 */
const ICON_DATA_PATTERN =
  /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
/** 单张图片上限 400KB。压缩后典型值 8-20KB，超过说明客户端没压缩或被人手工构造 */
const ICON_DATA_MAX_LENGTH = 400 * 1024;

/**
 * 新建 / 编辑来源渠道。
 *
 * 层级规则（严格两级，UI 不给改层级入口，这里再兜一层）：
 * - 不带 parentId  → 一级分类
 * - 带 parentId    → 二级分类，且父级必须存在、父级自身必须是一级
 * - 编辑时忽略提交上来的 parentId，层级创建时定死
 *
 * 重名检查：SQLite 里 NULL 互不相等，(parent_id, name) 唯一索引拦不住一级重名，
 * 所以父级为空的那一档要显式查一遍。
 */
export async function saveSourceChannelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = int(formData, "id");
  const name = required(formData, "name");
  if (!name) return { error: "请填写渠道名称" };
  if (name.length > 40) return { error: "渠道名称不超过 40 个字" };

  const iconRaw = text(formData, "iconData");
  if (iconRaw && !ICON_DATA_PATTERN.test(iconRaw)) {
    return { error: "图片格式不支持，请重新选择 PNG / JPEG / WebP / SVG 图片" };
  }
  if (iconRaw && iconRaw.length > ICON_DATA_MAX_LENGTH) {
    return { error: "图片体积过大，请换一张更小的图片" };
  }

  const values = {
    name,
    iconData: iconRaw,
    color: text(formData, "color"),
    sortOrder: int(formData, "sortOrder") ?? 0,
  };

  if (id == null) {
    // 新建：由提交的 parentId 决定层级
    const parentId = int(formData, "parentId");
    if (parentId != null) {
      const parent = db
        .select()
        .from(sourceChannel)
        .where(eq(sourceChannel.id, parentId))
        .get();
      if (!parent) return { error: "所属一级分类不存在" };
      if (parent.parentId != null) return { error: "来源渠道只支持两级，不能挂在二级分类下" };
    }
    if (hasSiblingName(name, parentId)) return { error: "同级下已有同名分类" };

    db.insert(sourceChannel).values({ ...values, parentId }).run();
  } else {
    const current = db
      .select()
      .from(sourceChannel)
      .where(eq(sourceChannel.id, id))
      .get();
    if (!current) return { error: "渠道不存在" };

    // 层级不可改：忽略表单里的 parentId，沿用库里的原值
    if (hasSiblingName(name, current.parentId, id)) {
      return { error: "同级下已有同名分类" };
    }

    db.update(sourceChannel).set(values).where(eq(sourceChannel.id, id)).run();
  }

  revalidatePath("/settings");
  revalidatePath("/library");
  return { ok: true };
}

/** 同一父级下是否已有同名分类（excludeId 用于编辑时排除自身） */
function hasSiblingName(
  name: string,
  parentId: number | null,
  excludeId?: number,
): boolean {
  const rows = db
    .select({ id: sourceChannel.id })
    .from(sourceChannel)
    .where(
      and(
        eq(sourceChannel.name, name),
        parentId == null
          ? isNull(sourceChannel.parentId)
          : eq(sourceChannel.parentId, parentId),
      ),
    )
    .all();
  return rows.some((row) => row.id !== excludeId);
}

/**
 * 删除来源渠道。
 *
 * 删一级时连同其下全部二级一起删（自引用外键已是 cascade，这里显式删一遍，
 * 与平台的处理保持一致，不依赖隐式级联）。引用这些渠道的流水全部回落为「未指定」。
 */
export async function deleteSourceChannelAction(formData: FormData): Promise<void> {
  const id = int(formData, "id");
  if (id == null) return;

  const row = db.select().from(sourceChannel).where(eq(sourceChannel.id, id)).get();
  if (!row) return;

  const children = db
    .select({ id: sourceChannel.id })
    .from(sourceChannel)
    .where(eq(sourceChannel.parentId, id))
    .all();
  const removedIds = [id, ...children.map((c) => c.id)];

  // 先解除引用，流水本身保留，只是来源渠道变成「未指定」
  db.update(viewRecord)
    .set({ sourceChannelId: null })
    .where(inArray(viewRecord.sourceChannelId, removedIds))
    .run();

  db.delete(sourceChannel).where(inArray(sourceChannel.id, removedIds)).run();

  revalidatePath("/settings");
  revalidatePath("/library");
}
