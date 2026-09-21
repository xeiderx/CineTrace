/**
 * 追剧进度的派生计算。
 *
 * 纯函数模块，刻意不引入数据库：服务端聚合（`lib/queries.ts`）与客户端组件
 * （档案库卡片、详情页进度面板）都要用同一套规则，规则放一处才不会两边算得不一样。
 *
 * 进度真源是 `view_episode` 的逐集记录。`view_record` 上的
 * `progressEpisode` / `episodesWatched` 只在某季完全没有逐集记录时兜底展示——
 * 它们是手动填的整数，算不出跳集，也算不出季的起止时间。
 */

/** 一集观看记录的最小形态，与 `view_episode` 的列对应 */
export type EpisodeMark = {
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string | null;
};

/** 参与进度推导的一条观影流水（只需这几个字段） */
export type ProgressRecordInput = {
  id: number;
  status: string;
  watchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  progressSeason: number | null;
  progressEpisode: number | null;
  episodesWatched: number | null;
  /** 被手动锁定、同步不得覆盖的字段名（JSON 数组字符串） */
  manualFieldsJson: string | null;
};

/** 一季的形态（对应 `work.seasonsJson` 的一项） */
export type SeasonInput = {
  seasonNumber: number;
  name: string;
  airDate: string | null;
  episodeCount: number;
  posterPath: string | null;
  voteAverage: number | null;
};

/** 时间的取值来源，界面据此标注是豆瓣带来的还是自己标的 */
export type DateSource = "manual" | "episode" | "douban";

export type ResolvedDate = {
  value: string | null;
  source: DateSource | null;
};

/** 手动锁定字段名。坏 JSON 一律当没锁，宁可不保护也不该让页面挂掉。 */
export function parseManualFields(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/** 该字段是否被手动锁定 */
export function isFieldLocked(
  record: ProgressRecordInput | null | undefined,
  field: string,
): boolean {
  if (!record) return false;
  return parseManualFields(record.manualFieldsJson).includes(field);
}

export type SeasonStats = SeasonInput & {
  /** 已看的集号，升序。跳集时中间会缺号 */
  watchedEpisodes: number[];
  /** 已看集数。优先由逐集记录派生，没有任何逐集记录时才用流水手填的兜底值 */
  watchedCount: number;
  /** 总集数已知且已看齐（逐集看齐，或豆瓣标记该季看过） */
  completed: boolean;
  /** 完成判定的依据：本地进度看齐 / 豆瓣标记看过；未完成时为 null */
  completionSource: "progress" | "douban" | null;
  /** 该季是否有逐集记录。为 false 时 watchedCount 来自流水手填的兜底值 */
  hasEpisodeData: boolean;
  /** 「标记到第几集」的落点：已看集号的最大值 */
  lastWatched: number;
  /** 下一集集号；已看完或总集数未知时为 null */
  nextEpisode: number | null;
  /** 逐集记录的最早日期；无逐集记录时退化为该季豆瓣标记的时间 */
  startedAt: ResolvedDate;
  /** 该季看完时间。未看完时为 null（逐集最晚日期只代表最近一次观看） */
  finishedAt: ResolvedDate;
  /** 该季豆瓣条目的评分。豆瓣按季建条目，所以这就是这一季的评分 */
  rating: number | null;
  /** 该季对应的豆瓣流水（多条时取最近一条），没有则为 null */
  record: ProgressRecordInput | null;
};

export type ShowProgress = {
  /** 已看集数合计。一条逐集记录都没有时，退回流水手填的累计集数 */
  watchedCount: number;
  /** 总集数合计：优先按 TMDB 分季求和，没有分季时用 work.episodeCount */
  totalCount: number;
  /** 正追到哪一季；无从判断时为 null */
  currentSeason: number | null;
  /** 整剧看完：每一季都看完，或豆瓣已把最近一条流水标成「看过」 */
  completed: boolean;
  /** 整剧是否有逐集记录。为 false 时进度来自流水手填值 */
  hasEpisodeData: boolean;
  /** 整剧开始时间 */
  startedAt: ResolvedDate;
  /** 整剧看完时间。未看完时为 null */
  finishedAt: ResolvedDate;
  seasons: SeasonStats[];
  /** 已看完的季数 */
  completedSeasonCount: number;
};

/** 按 `watchedAt` 降序、`id` 降序取最近一条；与 queries.latestRecord 口径一致 */
function latestBy<T extends { watchedAt: string | null; id: number }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const left = a.watchedAt ?? "";
    const right = b.watchedAt ?? "";
    if (left !== right) return left < right ? 1 : -1;
    return b.id - a.id;
  })[0];
}

/** 取最早的 ISO 日期文本；忽略空值。ISO 文本按字典序比较即等价于按时间比较 */
function minDate(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (best === null || trimmed < best) best = trimmed;
  }
  return best;
}

function maxDate(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (best === null || trimmed > best) best = trimmed;
  }
  return best;
}

/**
 * 整剧的某个时间点。优先级：
 * ① 手填并锁定 → ② 逐集记录 → ③ 流水的对应时间（豆瓣「在看」写在 startedAt）
 *
 * 手填值能被识别，靠的是编辑记录时自动写进 `manualFieldsJson` 的锁；
 * 没锁就说明用户没动过它，让更精确的逐集数据说话。
 */
function resolveShowDate({
  manualField,
  manualValue,
  episodeDate,
  fallbackRecord,
  fallbackValue,
}: {
  manualField: string;
  manualValue: string | null;
  episodeDate: string | null;
  fallbackRecord: ProgressRecordInput | null;
  fallbackValue: string | null;
}): ResolvedDate {
  if (manualValue?.trim() && isFieldLocked(fallbackRecord, manualField)) {
    return { value: manualValue, source: "manual" };
  }
  if (episodeDate) return { value: episodeDate, source: "episode" };
  if (fallbackValue?.trim()) {
    // 豆瓣同步把「在看」日期写进 startedAt、把「看过」日期写进 watchedAt，
    // 所以带日期的流水都当作豆瓣来源；纯手工录入的流水同样是这个兜底路径，
    // 不额外区分——数值本身是一样的，标错来源比不标更误导。
    return { value: fallbackValue, source: "douban" };
  }
  // 该字段被锁定但却是空的：用户明确清空过，就不要再拿豆瓣的值填回去
  if (isFieldLocked(fallbackRecord, manualField)) {
    return { value: null, source: "manual" };
  }
  return { value: null, source: null };
}

/**
 * 汇总一部剧的追剧进度。
 *
 * `lastRecord` 是最近一条流水，用于整剧时间的兜底与锁定判断；
 * 单个季的时间兜底则用该季自己的流水。
 */
export function buildShowProgress({
  seasons,
  episodes,
  records,
  episodeCount,
}: {
  seasons: SeasonInput[];
  episodes: EpisodeMark[];
  records: ProgressRecordInput[];
  /** `work.episodeCount`，没有分季结构时作为总集数的兜底 */
  episodeCount: number | null;
}): ShowProgress {
  const episodesBySeason = new Map<number, EpisodeMark[]>();
  for (const mark of episodes) {
    const bucket = episodesBySeason.get(mark.seasonNumber);
    if (bucket) bucket.push(mark);
    else episodesBySeason.set(mark.seasonNumber, [mark]);
  }

  // 该季对应的流水：豆瓣一季一条，多条时取最近一条。
  // 单季剧的标题里没有季号，流水上就没有 progressSeason——
  // 这种情况下全部流水都算这一季的（与 lib/queries 的 mergeSeasons 同一处理）。
  const singleSeason = seasons.length === 1 ? seasons[0].seasonNumber : null;
  const recordBySeason = new Map<number, ProgressRecordInput[]>();
  for (const record of records) {
    const seasonNo =
      record.progressSeason ?? (singleSeason !== null ? singleSeason : null);
    if (seasonNo == null) continue;
    const bucket = recordBySeason.get(seasonNo);
    if (bucket) bucket.push(record);
    else recordBySeason.set(seasonNo, [record]);
  }

  const stats: SeasonStats[] = seasons.map((season) => {
    const marks = episodesBySeason.get(season.seasonNumber) ?? [];
    const record = latestBy(recordBySeason.get(season.seasonNumber) ?? []);

    const total = season.episodeCount;
    const uniqueEpisodes = Array.from(
      new Set(marks.map((m) => m.episodeNumber)),
    ).sort((a, b) => a - b);
    const hasEpisodeData = uniqueEpisodes.length > 0;

    // 豆瓣把这条流水标成「看过」＝用户认定这一季看完了
    const doubanCompleted = record?.status === "watched";

    // 没有任何逐集记录时，用流水上手填的「看到第几集」当连续进度展示。
    // progressEpisode 的字面语义就是「看到第 N 集」，连续展开是它最忠实的解读；
    // 用户一旦在进度面板点任何一格，就会落成真实逐集记录并接管展示。
    const fallbackProgress = record?.progressEpisode ?? null;
    const capToTotal = (n: number) => (total > 0 ? Math.min(n, total) : n);

    let watchedEpisodes: number[];
    if (doubanCompleted && total > 0) {
      // 豆瓣的「看过」是用户明确表态整季看完，比逐集明细更权威。
      // 两者冲突时会造出「标注已看完、进度却停在 5/23」的自相矛盾展示。
      watchedEpisodes = Array.from({ length: total }, (_, i) => i + 1);
    } else if (hasEpisodeData) {
      // 集号可能超过 TMDB 记录的总集数（TMDB 未更新分季、或用户多标了一集），
      // 滤掉越界集号，避免显示成 25/24
      watchedEpisodes =
        total > 0 ? uniqueEpisodes.filter((n) => n <= total) : uniqueEpisodes;
    } else if (fallbackProgress && fallbackProgress > 0) {
      const upper = capToTotal(fallbackProgress);
      watchedEpisodes = Array.from({ length: upper }, (_, i) => i + 1);
    } else {
      watchedEpisodes = [];
    }

    const watchedCount = watchedEpisodes.length;
    const completed = total > 0 ? watchedCount >= total : doubanCompleted;
    const completionSource: SeasonStats["completionSource"] = completed
      ? doubanCompleted
        ? "douban"
        : "progress"
      : null;

    const episodeDates = marks.map((m) => m.watchedAt);
    const episodeStarted = minDate(episodeDates);
    const episodeFinished = maxDate(episodeDates);

    // 该季没有任何逐集数据时，才退回流水的日期：豆瓣的「在看」是开始、
    // 「看过」的标记日算看完，与整剧的兜底口径保持一致
    const fallbackStart = record
      ? record.startedAt ?? (record.status === "watching" ? record.watchedAt : null)
      : null;
    const fallbackEnd = record
      ? record.finishedAt ?? (record.status === "watched" ? record.watchedAt : null)
      : null;

    const lastWatched =
      watchedEpisodes.length > 0 ? watchedEpisodes[watchedEpisodes.length - 1] : 0;

    return {
      ...season,
      watchedEpisodes,
      watchedCount,
      completed,
      completionSource,
      hasEpisodeData,
      lastWatched,
      // 已看齐就没有下一集；否则取最大集号 +1，跳着看时也只会补在末尾
      nextEpisode: completed ? null : lastWatched + 1,
      startedAt: episodeStarted
        ? { value: episodeStarted, source: "episode" }
        : { value: fallbackStart, source: fallbackStart ? "douban" : null },
      // 没看完就没有「看完时间」——逐集最晚日期只代表最近一次观看，不是结束
      finishedAt:
        episodeFinished && completed
          ? { value: episodeFinished, source: "episode" }
          : {
              value: completed ? fallbackEnd : null,
              source: completed && fallbackEnd ? "douban" : null,
            },
      rating: record?.rating ?? null,
      record,
    };
  });

  // TMDB 分季里没有的季号（例如进度标在第 5 季、但库里的分季结构只到第 3 季）
  // 也要计入合计，否则「已看 N 集」会凭空少掉
  const knownSeasons = new Set(seasons.map((s) => s.seasonNumber));
  const orphanEpisodeCount = episodes.filter(
    (m) => !knownSeasons.has(m.seasonNumber),
  ).length;

  const seasonTotal = seasons.reduce((sum, s) => sum + (s.episodeCount ?? 0), 0);
  const totalCount = seasonTotal > 0 ? seasonTotal : episodeCount ?? 0;

  const latest = latestBy(records);
  const hasEpisodeData = episodes.length > 0;
  const seasonWatchedSum =
    stats.reduce((sum, s) => sum + s.watchedCount, 0) + orphanEpisodeCount;
  // 一条逐集记录都没有时，改用流水上手动填的累计集数；它跨季累计，比按季求和更可信
  const watchedCount =
    !hasEpisodeData && latest?.episodesWatched
      ? latest.episodesWatched
      : seasonWatchedSum;

  // 有分季结构时以「每季都看完」为准；分季缺失（TMDB 没匹配上）时只能信豆瓣的「看过」
  const completed =
    seasons.length > 0
      ? stats.every((s) => s.completed)
      : latest?.status === "watched";

  const startedAt = resolveShowDate({
    manualField: "startedAt",
    manualValue: latest?.startedAt ?? null,
    episodeDate: minDate(episodes.map((m) => m.watchedAt)),
    fallbackRecord: latest,
    fallbackValue: latest?.startedAt ?? null,
  });

  const finishedAt = resolveShowDate({
    manualField: "finishedAt",
    manualValue: latest?.finishedAt ?? null,
    // 没全部看完就不给整剧的「看完时间」，避免把中途的最近一次观看当结束
    episodeDate: completed ? maxDate(episodes.map((m) => m.watchedAt)) : null,
    fallbackRecord: latest,
    fallbackValue: completed
      ? (latest?.finishedAt ??
        (latest?.status === "watched" ? latest.watchedAt : null))
      : null,
  });

  // 正追的那一季：从前往后第一个没看完的季。全部看完就没有「下一季」可推
  const current = completed ? null : stats.find((s) => !s.completed) ?? null;

  return {
    watchedCount,
    totalCount: totalCount + orphanEpisodeCount,
    currentSeason: current?.seasonNumber ?? null,
    completed,
    hasEpisodeData,
    startedAt,
    finishedAt,
    seasons: stats,
    completedSeasonCount: stats.filter((s) => s.completed).length,
  };
}

/**
 * 追剧进度的简版文案，供档案库卡片等窄处使用。
 * 与 `progressLabel` 的区别：这里的数据来自逐集记录，能给出「已看 x/N 集」。
 */
export function showProgressLabel(
  progress: Pick<
    ShowProgress,
    "currentSeason" | "watchedCount" | "totalCount" | "completed"
  >,
): string | null {
  const { currentSeason, watchedCount, totalCount, completed } = progress;

  if (completed) {
    return totalCount > 0 ? `已看完 · 共 ${totalCount} 集` : "已看完";
  }
  if (currentSeason != null) {
    const tail = totalCount > 0 ? ` · ${watchedCount}/${totalCount} 集` : "";
    return `第 ${currentSeason} 季追剧中${tail}`;
  }
  if (watchedCount > 0) {
    return totalCount > 0 ? `已看 ${watchedCount}/${totalCount} 集` : `已看 ${watchedCount} 集`;
  }
  return null;
}

/** 时间的展示后缀，标注这个日期是哪儿来的 */
export function dateSourceHint(source: DateSource | null): string | null {
  if (source === "manual") return "手动";
  if (source === "episode") return "逐集";
  if (source === "douban") return "豆瓣";
  return null;
}

/** 「标记下一集」的操作目标 */
export type NextEpisodeTarget = {
  seasonNumber: number;
  seasonName: string;
  /** 要标记的集号，即当前进度的下一集 */
  episodeNumber: number;
  /** 标完这一集该季就看齐了 */
  completesSeason: boolean;
  /** 本季看完后接上的下一季名；没有后续未看完的季时为 null */
  nextSeasonName: string | null;
};

/**
 * 从整剧进度里取出「下一集」这个操作目标，供列表页的快捷按钮用。
 *
 * 只对「在看」的剧有意义：一集都没标记的剧不该在档案库里挂满「第 1 集」按钮，
 * 想开始看应该去详情页决定从哪一集、哪一天开始。整剧看完同理没有下一集。
 *
 * `allowZeroProgress` 是给追剧页开的例外：那儿列出的剧本来就都是用户明确标了
 * 想看的，一集没标记也应当能就地开始追，而不必先进详情页。档案库不传这个开关，
 * 保持「零进度不挂按钮」的克制。
 */
export function nextEpisodeTarget(
  progress: ShowProgress,
  options?: { allowZeroProgress?: boolean },
): NextEpisodeTarget | null {
  const { currentSeason, seasons, completed, watchedCount } = progress;
  if (completed || currentSeason == null) return null;
  if (watchedCount === 0 && !options?.allowZeroProgress) return null;

  // currentSeason 只是「第一个没看完的季」，它可能没有集数（TMDB 没给分季结构），
  // 这时往后找一个有集数的季，能做进度标记的才是有效目标
  const season = seasons.find(
    (s) =>
      s.seasonNumber >= currentSeason &&
      !s.completed &&
      s.episodeCount > 0 &&
      s.nextEpisode != null &&
      s.nextEpisode <= s.episodeCount,
  );
  if (!season) return null;

  // find 的谓词已经滤掉 null，但 TS 不会把谓词收窄带到 find 的结果类型上，
  // 这里再取一次局部变量显式收窄
  const episodeNumber = season.nextEpisode;
  if (episodeNumber == null) return null;

  const nextSeason =
    seasons.find((s) => s.seasonNumber > season.seasonNumber && !s.completed) ??
    null;

  return {
    seasonNumber: season.seasonNumber,
    seasonName: season.name,
    episodeNumber,
    completesSeason: episodeNumber === season.episodeCount,
    nextSeasonName: nextSeason?.name ?? null,
  };
}

/**
 * 本地时区的今天，形如 `2025-09-21`。
 *
 * 不要用 `new Date().toISOString().slice(0, 10)`：那取的是 UTC 日期。
 * 容器时区固定为 Asia/Shanghai（UTC+8）时，本地 00:00–07:59 之间取到的
 * 会是前一天，清早标记的一集会被记到昨天。
 */
export function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
