import { EnvHttpProxyAgent, fetch } from "undici";
import { getSetting } from "@/lib/settings";

/**
 * TMDB 客户端与分层匹配策略。
 *
 * 匹配是「豆瓣条目 → TMDB 作品」的桥梁。豆瓣列表页给的是
 * 「中文名 / 原名 / 别名…」，TMDB 的检索对中文名并不总是友好，
 * 因此按 A（中文名）→ B（原名）→ C（剧集季）逐层降级，
 * 策略取自 Phase 0 实测对比（reference/phase0-strategy.mjs）。
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_TIMEOUT_MS = 20_000;
/** 策略之间与页之间的间隔，Phase 0 实测节奏 */
const STRATEGY_GAP_MS = 200;

/** 与豆瓣抓取共用同一套代理分流策略。 */
const dispatcher = new EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * TMDB API Key 取值。设置页填写的值优先，环境变量作兜底——
 * 设置存在 SQLite 里，web 与 worker 共享同一个库，保存后无需重启容器。
 */
export function getTmdbKey(): string {
  const fromSetting = String(getSetting("tmdb.apiKey") ?? "").trim();
  return fromSetting || process.env.TMDB_API_KEY?.trim() || "";
}

/** 未配置 API Key 时匹配能力整体不可用，任务应尽早退回。 */
export function hasTmdbKey(): boolean {
  return Boolean(getTmdbKey());
}

/* -------------------------------------------------------------------------- */
/*                                  原始请求                                   */
/* -------------------------------------------------------------------------- */

type TmdbRawResult = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string | null;
  vote_average?: number;
};

export type TmdbResult = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  /** 中文标题（受 language 参数影响） */
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
};

export type TmdbSearchResponse = {
  results: TmdbResult[];
  /** 请求层面的失败（网络 / 401 等），与「搜不到」区分开 */
  error?: number;
};

/** TMDB 的年份字段在电影与剧集上不同名，统一取一次。 */
function yearOf(raw: TmdbRawResult): number | null {
  return Number((raw.release_date || raw.first_air_date || "").slice(0, 4)) || null;
}

function normalize(raw: TmdbRawResult, fallbackType: "movie" | "tv"): TmdbResult {
  const mediaType = raw.media_type === "tv" || raw.media_type === "movie" ? raw.media_type : fallbackType;
  return {
    tmdbId: raw.id,
    mediaType,
    title: raw.title || raw.name || "",
    originalTitle: raw.original_title || raw.original_name || null,
    year: yearOf(raw),
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    overview: raw.overview ?? null,
    releaseDate: raw.release_date || raw.first_air_date || null,
    voteAverage: typeof raw.vote_average === "number" ? raw.vote_average : null,
  };
}

/**
 * 发一次 TMDB 请求并解析 JSON。
 * 失败一律返回 `error`（HTTP 状态，网络异常为 0），把「失败」与「搜不到」
 * 的区分交给调用方。
 */
async function requestTmdb<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<{ data: T | null; error?: number }> {
  const query = new URLSearchParams({
    language: String(getSetting("tmdb.language")),
    api_key: getTmdbKey(),
    ...params,
  });

  try {
    const res = await fetch(`${TMDB_BASE}/${path}?${query}`, {
      dispatcher,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    });
    if (!res.ok) return { data: null, error: res.status };
    return { data: (await res.json()) as T };
  } catch {
    return { data: null, error: 0 };
  }
}

/**
 * 调用一次 TMDB 检索接口。
 * 结果里的 `person`（search/multi 会返回演员）一律剔除——它们不是作品。
 */
export async function tmdb(
  path: string,
  params: Record<string, string> = {},
  fallbackType: "movie" | "tv" = "movie",
): Promise<TmdbSearchResponse> {
  const { data, error } = await requestTmdb<{ results?: TmdbRawResult[] }>(path, params);
  if (!data) return { results: [], error };

  return {
    results: (data.results ?? [])
      .filter((r) => r.media_type !== "person")
      .map((r) => normalize(r, fallbackType)),
  };
}

/** 校验某部剧是否存在指定季。策略 C 用来排除「名同但季数不够」的误匹配。 */
export async function tvSeasonExists(tvId: number, season: number): Promise<boolean> {
  const { error } = await requestTmdb(`tv/${tvId}/season/${season}`);
  return !error;
}

/* -------------------------------------------------------------------------- */
/*                                  作品详情                                   */
/* -------------------------------------------------------------------------- */

/** 详情接口里我们关心的字段；电影与剧集的字段名不同，统一后再返回。 */
type TmdbRawSeason = {
  season_number?: number;
  name?: string;
  air_date?: string | null;
  episode_count?: number;
  poster_path?: string | null;
  vote_average?: number;
};

type TmdbRawDetail = {
  runtime?: number | null;
  episode_run_time?: number[];
  last_episode_to_air?: { runtime?: number | null } | null;
  release_date?: string;
  first_air_date?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string | null;
  poster_path?: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: TmdbRawSeason[];
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
  genres?: { name?: string }[];
  created_by?: { name?: string }[];
  credits?: { crew?: { job?: string; name?: string }[] };
};

/**
 * 一季的概要信息，来自 `/tv/{id}` 的 `seasons[]`。
 * 豆瓣把每一季当成独立条目，这里缓存整剧的季结构，用于把多条
 * 豆瓣条目归并到同一部剧下展示。
 */
export type TmdbSeason = {
  seasonNumber: number;
  name: string;
  airDate: string | null;
  episodeCount: number;
  posterPath: string | null;
  voteAverage: number | null;
};

export type TmdbDetail = {
  /** 分钟：电影为片长，剧集为单集时长 */
  runtime: number | null;
  releaseDate: string | null;
  imdbId: string | null;
  genres: string[];
  directors: string[];
  /** 整剧海报，剧集不用季海报 */
  posterPath: string | null;
  /** 总季数 / 总集数，仅剧集有 */
  seasonCount: number | null;
  episodeCount: number | null;
  /** 分季结构，已滤掉特辑（season_number = 0） */
  seasons: TmdbSeason[];
  /** 以下两项供手动匹配时一站式回填 */
  overview: string | null;
  originalTitle: string | null;
};

/** 季结构的原始字段容错：缺 season_number 的条目直接丢掉。 */
function normalizeSeasons(raw: TmdbRawSeason[] | undefined): TmdbSeason[] {
  return (raw ?? [])
    .filter((s) => typeof s.season_number === "number" && s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number as number,
      name: s.name || `第 ${s.season_number} 季`,
      airDate: s.air_date || null,
      episodeCount: s.episode_count ?? 0,
      posterPath: s.poster_path ?? null,
      voteAverage: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
    }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * 拉一部作品在 TMDB 上的详情，补齐豆瓣列表页没有的字段。
 *
 * 豆瓣详情页已不再抓取（机房 IP 必被风控），时长/类型/导演等
 * 只能靠这里补。请求失败不抛错——元数据缺失不应该让同步中断。
 */
export async function tmdbDetail(
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<TmdbDetail | null> {
  const { data: body } = await requestTmdb<TmdbRawDetail>(`${mediaType}/${tmdbId}`, {
    append_to_response: "credits,external_ids",
  });
  if (!body) return null;

  const isTv = mediaType === "tv";

  // 剧集没有顶层 runtime，退到「分集时长 → 最近一集时长」
  const runtime = isTv
    ? body.episode_run_time?.[0] ?? body.last_episode_to_air?.runtime ?? null
    : body.runtime ?? null;

  // 剧集的主创在 created_by，电影才是 crew 里的 Director
  const directors = isTv
    ? (body.created_by ?? []).map((c) => c.name ?? "").filter(Boolean)
    : (body.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name ?? "").filter(Boolean);

  return {
    runtime: runtime && runtime > 0 ? runtime : null,
    releaseDate: (isTv ? body.first_air_date : body.release_date) || null,
    imdbId: (isTv ? body.external_ids?.imdb_id : body.imdb_id) || null,
    genres: (body.genres ?? []).map((g) => g.name ?? "").filter(Boolean),
    directors,
    posterPath: body.poster_path ?? null,
    seasonCount: isTv ? body.number_of_seasons ?? null : null,
    episodeCount: isTv ? body.number_of_episodes ?? null : null,
    seasons: isTv ? normalizeSeasons(body.seasons) : [],
    overview: body.overview?.trim() || null,
    originalTitle: (isTv ? body.original_name : body.original_title)?.trim() || null,
  };
}

/* -------------------------------------------------------------------------- */
/*                                 手动检索                                    */
/* -------------------------------------------------------------------------- */

/** 手动匹配的候选条数上限：够挑就行，翻页对「修正个别错误」是负担。 */
const SEARCH_LIMIT = 12;

/** 详情接口的返回与检索结果字段基本一致，复用 normalize 的字段口径。 */
function detailToResult(raw: TmdbRawDetail & { id?: number }, mediaType: "movie" | "tv"): TmdbResult | null {
  if (typeof raw.id !== "number") return null;
  return normalize(
    {
      id: raw.id,
      media_type: mediaType,
      title: raw.title,
      name: raw.name,
      original_title: raw.original_title,
      original_name: raw.original_name,
      release_date: raw.release_date,
      first_air_date: raw.first_air_date,
      poster_path: raw.poster_path ?? null,
      overview: raw.overview ?? null,
    },
    mediaType,
  );
}

/**
 * 手动检索候选用。
 *
 * 输入纯数字时当作 TMDB ID，直接点查电影与剧集两个详情接口；
 * 否则关键词走 `search/multi`，电影与剧集混排，剔除人物类结果。
 * 返回数组可能为空——「搜不到」和「请求失败」都归为空列表，
 * 调用方只看「有没有候选」。
 */
export async function searchTmdb(query: string): Promise<TmdbResult[]> {
  const keyword = query.trim();
  if (!keyword) return [];

  if (/^\d+$/.test(keyword)) {
    const id = Number(keyword);
    const [movie, tv] = await Promise.all([
      requestTmdb<TmdbRawDetail & { id?: number }>(`movie/${id}`),
      requestTmdb<TmdbRawDetail & { id?: number }>(`tv/${id}`),
    ]);
    return [
      movie.data ? detailToResult(movie.data, "movie") : null,
      tv.data ? detailToResult(tv.data, "tv") : null,
    ].filter((r): r is TmdbResult => r !== null);
  }

  const { results } = await tmdb("search/multi", { query: keyword });

  // 同名作品可能电影、剧集都命中，按「类型 + ID」去重后再截断
  const seen = new Set<string>();
  return results
    .filter((r) => {
      const key = `${r.mediaType}:${r.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SEARCH_LIMIT);
}

/* -------------------------------------------------------------------------- */
/*                                 分层匹配                                    */
/* -------------------------------------------------------------------------- */

export type MatchStrategy = "A" | "B" | "C";

export type MatchHit = {
  strategy: MatchStrategy;
  /** 该策略实际使用的检索词，便于排查误匹配 */
  query: string;
  result: TmdbResult;
  /** 年份是否对得上；豆瓣无年份时为 null（无法核对） */
  yearOk: boolean | null;
  score: number;
};

export type MatchOutcome =
  | { ok: true; hit: MatchHit }
  /** `no_match` 三策略全空；`low_score` 有结果但年份对不上 */
  | { ok: false; reason: "no_match" | "low_score"; detail: string; score: number | null };

/** 匹配所需的豆瓣侧输入，由列表页条目提供。 */
export type MatchInput = {
  titleCn: string;
  aliases: string[];
  year: number | null;
};

/**
 * 命中得分。
 * 年份核对是最强的信号，策略层级只做次要加权——
 * 策略 A 之所以排在最前，是因为它的检索词最贴近用户认知。
 */
function scoreOf(strategy: MatchStrategy, yearOk: boolean | null): number {
  const base = 60;
  const yearBonus = yearOk === true ? 30 : 0;
  const strategyBonus = strategy === "A" ? 10 : strategy === "B" ? 5 : 0;
  return base + yearBonus + strategyBonus;
}

/** 策略 A：纯中文名 search/multi。 */
async function strategyA(input: MatchInput): Promise<MatchHit | null> {
  if (!input.titleCn) return null;
  const { results } = await tmdb("search/multi", { query: input.titleCn });
  const first = results[0];
  if (!first) return null;
  const yearOk = yearCheck(input.year, first.year);
  return { strategy: "A", query: input.titleCn, result: first, yearOk, score: scoreOf("A", yearOk) };
}

/** 策略 B：别名里挑「原文名」——同时含拉丁字母与非拉丁文字，说明是原始片名。 */
async function strategyB(input: MatchInput): Promise<MatchHit | null> {
  const original = input.aliases.find(
    (a) => /[a-zA-Z\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF]/.test(a) && /[a-zA-Z\u0E00-\u0E7F\u3040-\u30FF]/.test(a),
  );
  if (!original) return null;
  const { results } = await tmdb("search/multi", { query: original });
  const first = results[0];
  if (!first) return null;
  const yearOk = yearCheck(input.year, first.year);
  return { strategy: "B", query: original, result: first, yearOk, score: scoreOf("B", yearOk) };
}

/** 中文数字转阿拉伯数字，供「第X季」解析使用（季数不会超过十，朴素替换足够）。 */
function toArabicSeason(raw: string): number | null {
  const arabic = raw.replace(/[一二三四五六七八九十]/g, (s) =>
    String("一二三四五六七八九十".indexOf(s) + 1),
  );
  return Number(arabic) || null;
}

/**
 * 从标题里解析季号。
 * 取第一个「第X季」标记——「剑来 第一季·第二季」这类标题按第一季处理。
 */
export function parseSeasonNumber(title: string): number | null {
  const m = title.match(/第\s*([一二三四五六七八九十\d]+)\s*季/);
  return m?.[1] ? toArabicSeason(m[1]) : null;
}

/**
 * 剥掉「第X季」及其后的内容，得到整剧名。
 * 豆瓣把每一季当作独立条目，展示时要用整剧名。
 */
export function baseTitleOf(title: string): string {
  const m = title.match(/^(.*?)\s*第\s*[一二三四五六七八九十\d]+\s*季/);
  return m?.[1]?.trim() || title.trim();
}

/** 策略 C：中文名去掉「第X季」后 search/tv，并要求该季真实存在。 */
async function strategyC(input: MatchInput): Promise<MatchHit | null> {
  const season = parseSeasonNumber(input.titleCn);
  const base = baseTitleOf(input.titleCn);
  if (!season || !base) return null; // 无季数标识的条目不走剧集路径

  const { results } = await tmdb("search/tv", { query: base }, "tv");
  const first = results[0];
  if (!first) return null;
  if (!(await tvSeasonExists(first.tmdbId, season))) return null;

  return { strategy: "C", query: base, result: first, yearOk: null, score: scoreOf("C", null) };
}

function yearCheck(doubanYear: number | null, tmdbYear: number | null): boolean | null {
  if (!doubanYear || !tmdbYear) return null;
  return Math.abs(tmdbYear - doubanYear) <= 1;
}

/**
 * 依次尝试 A → B → C，返回第一个「年份可接受」的命中。
 * 若三层都只有年份对不上的结果，则判为 low_score 而不是 no_match，
 * 两者在设置页的排查含义不同。
 */
export async function matchWork(input: MatchInput): Promise<MatchOutcome> {
  const attempts: MatchHit[] = [];

  const a = await strategyA(input);
  if (a && a.yearOk !== false) return { ok: true, hit: a };
  if (a) attempts.push(a);

  await sleep(STRATEGY_GAP_MS);
  const b = await strategyB(input);
  if (b && b.yearOk !== false) return { ok: true, hit: b };
  if (b) attempts.push(b);

  await sleep(STRATEGY_GAP_MS);
  const c = await strategyC(input);
  if (c) return { ok: true, hit: c };
  // C 的命中条件已含季存在校验，走到这里说明剧集路径也没戏

  const best = attempts.sort((x, y) => y.score - x.score)[0];
  if (best) {
    return {
      ok: false,
      reason: "low_score",
      detail: `豆瓣年份 ${input.year ?? "未知"}，命中「${best.result.title}」(${best.result.year ?? "未知"}) 年份不符`,
      score: best.score,
    };
  }
  return { ok: false, reason: "no_match", detail: "A/B/C 三种策略均无结果", score: null };
}
