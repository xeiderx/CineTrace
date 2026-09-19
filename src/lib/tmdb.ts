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
  /** 制片国家。name 未必随 language 本地化，故同时取 iso_3166_1 做兜底翻译 */
  production_countries?: { iso_3166_1?: string; name?: string }[];
  credits?: {
    crew?: { job?: string; name?: string }[];
    cast?: TmdbRawCastMember[];
  };
  /** 全剧演员汇总，仅剧集接口支持；演员按角色分组在 roles 里 */
  aggregate_credits?: { cast?: TmdbRawAggregateCastMember[] };
};

type TmdbRawCastMember = {
  id?: number;
  name?: string;
  character?: string;
  profile_path?: string | null;
  order?: number;
};

type TmdbRawAggregateCastMember = {
  id?: number;
  name?: string;
  profile_path?: string | null;
  order?: number;
  roles?: { character?: string }[];
};

/** TMDB `/person/{id}`。简介只有这个接口才有，credits 里不带。 */
type TmdbRawPerson = {
  id?: number;
  name?: string;
  biography?: string | null;
  birthday?: string | null;
  place_of_birth?: string | null;
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

/**
 * 一位主创/演员。`profilePath` 是 TMDB 图床相对路径，
 * 展示时用 posterUrl 拼域名；简介不在这里，要点开时才按 id 单拉。
 */
export type TmdbCastMember = {
  /** TMDB person id，用于取简介 */
  id: number;
  name: string;
  /** 饰演角色，可能为空（尤其是剧集） */
  character: string | null;
  profilePath: string | null;
};

export type TmdbDetail = {
  /** 分钟：电影为片长，剧集为单集时长 */
  runtime: number | null;
  releaseDate: string | null;
  imdbId: string | null;
  genres: string[];
  directors: string[];
  /** 制片国家，已尽量译为中文 */
  countries: string[];
  /** 主演，按 TMDB 给出的番位排序，已截到 CAST_LIMIT */
  cast: TmdbCastMember[];
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

/**
 * 演员表截断长度。TMDB 的 credits.cast 按番位排好序，
 * 一部剧动辄上百人，取前若干位即可覆盖「主演」的含义。
 */
const CAST_LIMIT = 12;

/**
 * ISO 3166-1 → 中文名。TMDB 的 `production_countries[].name` 不随
 * language 参数本地化（稳定返回英文），所以用国家码查这张表，
 * 比直接存 "United States of America" 更符合界面语言。
 * 未收录的国家码退回 TMDB 给的原文。
 */
const COUNTRY_NAMES: Record<string, string> = {
  CN: "中国大陆", HK: "中国香港", TW: "中国台湾", MO: "中国澳门",
  US: "美国", JP: "日本", KR: "韩国", KP: "朝鲜",
  GB: "英国", FR: "法国", DE: "德国", IT: "意大利", ES: "西班牙",
  PT: "葡萄牙", NL: "荷兰", BE: "比利时", LU: "卢森堡", IE: "爱尔兰",
  CH: "瑞士", AT: "奥地利", SE: "瑞典", NO: "挪威", DK: "丹麦",
  FI: "芬兰", IS: "冰岛", PL: "波兰", CZ: "捷克", SK: "斯洛伐克",
  HU: "匈牙利", RO: "罗马尼亚", BG: "保加利亚", GR: "希腊", HR: "克罗地亚",
  RS: "塞尔维亚", SI: "斯洛文尼亚", BA: "波黑", MK: "北马其顿", AL: "阿尔巴尼亚",
  EE: "爱沙尼亚", LV: "拉脱维亚", LT: "立陶宛", UA: "乌克兰", BY: "白俄罗斯",
  RU: "俄罗斯", GE: "格鲁吉亚", AM: "亚美尼亚", AZ: "阿塞拜疆", KZ: "哈萨克斯坦",
  UZ: "乌兹别克斯坦", MN: "蒙古", TH: "泰国", VN: "越南", SG: "新加坡",
  MY: "马来西亚", PH: "菲律宾", ID: "印度尼西亚", KH: "柬埔寨", LA: "老挝",
  MM: "缅甸", BN: "文莱", IN: "印度", PK: "巴基斯坦", BD: "孟加拉国",
  LK: "斯里兰卡", NP: "尼泊尔", IR: "伊朗", TR: "土耳其", IL: "以色列",
  SA: "沙特阿拉伯", AE: "阿联酋", QA: "卡塔尔", KW: "科威特", LB: "黎巴嫩",
  JO: "约旦", IQ: "伊拉克", SY: "叙利亚", CA: "加拿大", AU: "澳大利亚",
  NZ: "新西兰", MX: "墨西哥", BR: "巴西", AR: "阿根廷", CL: "智利",
  CO: "哥伦比亚", PE: "秘鲁", VE: "委内瑞拉", EC: "厄瓜多尔", BO: "玻利维亚",
  PY: "巴拉圭", UY: "乌拉圭", CR: "哥斯达黎加", PA: "巴拿马", GT: "危地马拉",
  DO: "多米尼加", PR: "波多黎各", CU: "古巴", JM: "牙买加", ZA: "南非",
  EG: "埃及", MA: "摩洛哥", TN: "突尼斯", DZ: "阿尔及利亚", KE: "肯尼亚",
  NG: "尼日利亚", GH: "加纳", ET: "埃塞俄比亚", TZ: "坦桑尼亚", UG: "乌干达",
  ZW: "津巴布韦", SN: "塞内加尔", CI: "科特迪瓦", CM: "喀麦隆",
};

/** 把 TMDB 的制片国家译成中文，未收录的退回原文。 */
function normalizeCountries(raw: TmdbRawDetail["production_countries"]): string[] {
  const out: string[] = [];
  for (const c of raw ?? []) {
    const code = c.iso_3166_1?.toUpperCase() ?? "";
    const name = (code && COUNTRY_NAMES[code]) || c.name?.trim() || "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 只保留有 person id 的演员——没有 id 就取不到简介，展示价值有限。 */
function normalizeCast(raw: TmdbRawCastMember[] | undefined): TmdbCastMember[] {
  return (raw ?? [])
    .filter((c) => typeof c.id === "number" && Boolean(c.name?.trim()))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, CAST_LIMIT)
    .map((c) => ({
      id: c.id as number,
      name: (c.name as string).trim(),
      character: c.character?.trim() || null,
      profilePath: c.profile_path ?? null,
    }));
}

/**
 * 取剧集的演员表。
 *
 * 选集剧（配音向的《骇人来电》）的 `credits.cast` 是空的，演员只挂在
 * `aggregate_credits` 上；常规剧集两者都有且大体一致，所以只在
 * 「真的拿到空列表」时才退化，免得把已有的演员表洗一遍。
 */
function castOf(body: TmdbRawDetail): TmdbCastMember[] {
  const direct = normalizeCast(body.credits?.cast);
  if (direct.length > 0) return direct;

  const fallback = (body.aggregate_credits?.cast ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    character: c.roles?.[0]?.character,
    profile_path: c.profile_path,
    order: c.order,
  }));
  return normalizeCast(fallback);
}

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
    append_to_response: "credits,aggregate_credits,external_ids,production_countries",
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
    countries: normalizeCountries(body.production_countries),
    cast: castOf(body),
    posterPath: body.poster_path ?? null,
    seasonCount: isTv ? body.number_of_seasons ?? null : null,
    episodeCount: isTv ? body.number_of_episodes ?? null : null,
    seasons: isTv ? normalizeSeasons(body.seasons) : [],
    overview: body.overview?.trim() || null,
    originalTitle: (isTv ? body.original_name : body.original_title)?.trim() || null,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  人物简介                                   */
/* -------------------------------------------------------------------------- */

export type TmdbPerson = {
  tmdbPersonId: number;
  name: string;
  biography: string | null;
  birthday: string | null;
  placeOfBirth: string | null;
};

/**
 * 拉一位演员的生平。`credits` 里只有姓名和头像，简介必须单独请求，
 * 因此调用方务必先查 person 表的缓存——只在缓存未命中时才走到这里。
 * 失败返回 null，让界面退化成「暂无简介」而不是报错。
 */
export async function tmdbPerson(personId: number): Promise<TmdbPerson | null> {
  const { data: body } = await requestTmdb<TmdbRawPerson>(`person/${personId}`);
  if (!body || typeof body.id !== "number") return null;

  return {
    tmdbPersonId: body.id,
    name: body.name?.trim() || "",
    biography: body.biography?.trim() || null,
    birthday: body.birthday?.trim() || null,
    placeOfBirth: body.place_of_birth?.trim() || null,
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
 * 季号猜测：先按「第X季」认，认不出再看标题结尾的阿拉伯数字。
 * 豆瓣对续季有两种写法——「怪奇物语 第五季」和「模范出租车3」，
 * 只认前者会让后一种条目的标记挂不到 TMDB 的季结构上。
 *
 * 结尾数字只是猜测，库里有《美国队长4》这类电影，所以这里不区分影视，
 * 调用方必须再用作品类型和该剧真实的季列表复核一次。
 */
export function parseSeasonHint(title: string): number | null {
  const season = parseSeasonNumber(title);
  if (season !== null) return season;
  const m = title.match(/(\d{1,2})\s*$/);
  return m ? Number(m[1]) : null;
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
