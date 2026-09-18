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
const SEASON_TIMEOUT_MS = 15_000;
/** 策略之间与页之间的间隔，Phase 0 实测节奏 */
const STRATEGY_GAP_MS = 200;

/** 与豆瓣抓取共用同一套代理分流策略。 */
const dispatcher = new EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 未配置 API Key 时匹配能力整体不可用，任务应尽早退回。 */
export function hasTmdbKey(): boolean {
  return Boolean(process.env.TMDB_API_KEY?.trim());
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
 * 调用一次 TMDB 检索接口。
 * 结果里的 `person`（search/multi 会返回演员）一律剔除——它们不是作品。
 */
export async function tmdb(
  path: string,
  params: Record<string, string> = {},
  fallbackType: "movie" | "tv" = "movie",
): Promise<TmdbSearchResponse> {
  const query = new URLSearchParams({
    language: String(getSetting("tmdb.language")),
    api_key: process.env.TMDB_API_KEY ?? "",
    ...params,
  });

  try {
    const res = await fetch(`${TMDB_BASE}/${path}?${query}`, {
      dispatcher,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    });
    if (!res.ok) return { results: [], error: res.status };

    const body = (await res.json()) as { results?: TmdbRawResult[] };
    return {
      results: (body.results ?? [])
        .filter((r) => r.media_type !== "person")
        .map((r) => normalize(r, fallbackType)),
    };
  } catch {
    return { results: [], error: 0 };
  }
}

/** 校验某部剧是否存在指定季。策略 C 用来排除「名同但季数不够」的误匹配。 */
export async function tvSeasonExists(tvId: number, season: number): Promise<boolean> {
  const query = new URLSearchParams({
    language: String(getSetting("tmdb.language")),
    api_key: process.env.TMDB_API_KEY ?? "",
  });
  try {
    const res = await fetch(`${TMDB_BASE}/tv/${tvId}/season/${season}?${query}`, {
      dispatcher,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEASON_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  作品详情                                   */
/* -------------------------------------------------------------------------- */

/** 详情接口里我们关心的字段；电影与剧集的字段名不同，统一后再返回。 */
type TmdbRawDetail = {
  runtime?: number | null;
  episode_run_time?: number[];
  last_episode_to_air?: { runtime?: number | null } | null;
  release_date?: string;
  first_air_date?: string;
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
  genres?: { name?: string }[];
  created_by?: { name?: string }[];
  credits?: { crew?: { job?: string; name?: string }[] };
};

export type TmdbDetail = {
  /** 分钟：电影为片长，剧集为单集时长 */
  runtime: number | null;
  releaseDate: string | null;
  imdbId: string | null;
  genres: string[];
  directors: string[];
};

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
  const query = new URLSearchParams({
    language: String(getSetting("tmdb.language")),
    api_key: process.env.TMDB_API_KEY ?? "",
    append_to_response: "credits,external_ids",
  });

  try {
    const res = await fetch(`${TMDB_BASE}/${mediaType}/${tmdbId}?${query}`, {
      dispatcher,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as TmdbRawDetail;
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
    };
  } catch {
    return null;
  }
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

/** 策略 C：中文名去掉「第X季」后 search/tv，并要求该季真实存在。 */
async function strategyC(input: MatchInput): Promise<MatchHit | null> {
  const m = input.titleCn.match(/^(.*?)(?:第\s*([一二三四五六七八九十\d]+)\s*季)?$/);
  const base = (m?.[1] || input.titleCn).trim();
  if (!m?.[2] || !base) return null; // 无季数标识的条目不走剧集路径

  const season = toArabicSeason(m[2]);
  if (!season) return null;

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
  if (a?.yearOk !== false) return a ? { ok: true, hit: a } : { ok: false, reason: "no_match", detail: "A 无结果", score: null };
  if (a) attempts.push(a);

  await sleep(STRATEGY_GAP_MS);
  const b = await strategyB(input);
  if (b?.yearOk !== false) return b ? { ok: true, hit: b } : { ok: false, reason: "no_match", detail: "B 无结果", score: null };
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
