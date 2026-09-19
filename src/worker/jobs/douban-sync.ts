import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { syncIssue, viewRecord, work, type NewWork } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { VIEW_STATUS_LABELS, type ViewStatus } from "@/lib/labels";
import { archiveRaw } from "@/lib/douban/archive";
import { isBlocked, needsLogin, req } from "@/lib/douban/client";
import { PARSER_VERSION, parseListPage, parseListTotal, type ListPageItem } from "@/lib/douban/parse";
import {
  baseTitleOf,
  hasTmdbKey,
  matchWork,
  parseSeasonNumber,
  tmdbDetail,
  type MatchHit,
  type TmdbDetail,
} from "@/lib/tmdb";
import { runJob, type Job, type JobResult } from "../job";
import { randomInt, sleep, throttle } from "../throttle";

/**
 * 豆瓣同步主任务：把 Phase 0 验证过的链路正式产品化。
 *
 * 抓取列表页 → 解析 → TMDB 匹配 → 落 work/view_record → 归档 + 错误记录。
 *
 * 关键设计：
 * - 幂等：view_record.sourceKey = `douban:{id}`，重跑不会产生重复记录
 * - 增量早停：常规轮每个列表只抓第 1 页，遇到库里已有且元数据齐全的条目就停。
 *   豆瓣列表按标记时间倒序，新条目必定落在首页，所以首页翻完就够发现新增；
 *   用户事后修改老评分/短评这类变动发现不了，交给每周一次的全量回扫。
 * - 三列表同轮抓取，顺序固定「想看 → 在看 → 看过」：sourceKey 全局唯一，
 *   同一条目跨列表只能留一条记录，靠这个顺序让优先级高的状态最后写入、覆盖前者。
 * - 整季归并：豆瓣把每一季当作独立条目，这里按 TMDB 的 `(mediaType, tmdbId)`
 *   归到同一行 work，季信息记在 seasons_json，每季仍各自写一条 view_record
 * - 手动优先：matchStatus 为 manual 的条目不再自动改写绑定关系
 * - 不抓详情页：机房 IP 访问豆瓣详情页必被风控拦截，
 *   而匹配只需列表页的「中文名 / 别名 / 年份」，
 *   时长、类型、导演等缺失字段改由 TMDB 详情接口补齐
 */

const DOUBAN_ORIGIN = "https://movie.douban.com";
/** 豆瓣列表页固定每页 15 条 */
const LIST_PAGE_SIZE = 15;
/**
 * 翻页间隔区间（毫秒）。全量回扫一轮上百次请求，
 * 所以刻意比 TMDB 侧慢得多；这里取随机区间而非固定值——
 * 固定 5 秒的机械节奏是最典型的机器特征，比等久一点更容易被拦。
 */
const PAGE_GAP_MIN_MS = 5000;
const PAGE_GAP_MAX_MS = 12_000;
/** 400 页上限：防止总数解析异常导致无限翻页 */
const MAX_START = 6000;
/** 两次全量回扫的最小间隔：常规轮靠它决定这轮要不要完整翻页 */
const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 要抓的三个豆瓣列表。顺序即优先级，必须从低到高——
 * 同一条目在多个列表中时，后面的状态会覆盖前面的（已看胜出在看，在看胜出想看）。
 */
const LISTS: ReadonlyArray<{ status: ViewStatus; path: string }> = [
  { status: "wish", path: "wish" },
  { status: "watching", path: "do" },
  { status: "watched", path: "collect" },
];

/** 未知媒体类型的兜底猜测：带「第X季」标识的按剧集处理。 */
function guessMediaType(titleCn: string): "movie" | "tv" {
  return /第\s*[一二三四五六七八九十\d]+\s*季/.test(titleCn) ? "tv" : "movie";
}

function listUrl(uid: string, path: string, start: number): string {
  return `${DOUBAN_ORIGIN}/people/${encodeURIComponent(uid)}/${path}?sort=time&start=${start}`;
}

export type DoubanSyncProgress = {
  /** 已处理的条目数 */
  seen: number;
  /** 列表页声明的总数，解析不到时为 null */
  total: number | null;
};

type DoubanSyncOptions = {
  /** 手动同步时忽略 sync.enabled 总开关 */
  force?: boolean;
  /** 强制完整翻页，忽略「每周一次」的全量间隔（手动同步用） */
  full?: boolean;
  onProgress?: (progress: DoubanSyncProgress) => void;
};

export const doubanSyncJob: Job = {
  name: "douban-sync",
  kind: "douban-html",
  intervalMs: 6 * 60 * 60 * 1000,
  // 全量回扫时上百页配上 5~12 秒的随机间隔，最坏要跑半小时以上；
  // 锁必须比任务长，否则兜底过期会让两个进程同时抓同一个账号
  lockTtlMs: 60 * 60 * 1000,
  run: () => runDoubanSync(),
};

/**
 * 手动同步入口。与定时任务共用锁名与 kind——两者是同一件事，必须互斥；
 * 手动跑完同样会写 sync_run，因此也能作为下次定时的计时起点。
 * 返回 ran=false 表示锁被 worker 抢走了（它正在同步），没有真的执行。
 */
export async function runManualDoubanSync(
  onProgress: (progress: DoubanSyncProgress) => void,
): Promise<{ ran: boolean; result: JobResult | null }> {
  let result: JobResult | null = null;
  const job: Job = {
    ...doubanSyncJob,
    run: async () => {
      result = await runDoubanSync({ force: true, full: true, onProgress });
      return result;
    },
  };
  const outcome = await runJob(job);
  return { ran: outcome.ran, result };
}

/**
 * 抓取一轮豆瓣的「想看 / 在看 / 看过」三列表并落库。定时任务与手动同步共用此实现，
 * 差别只在是否受总开关约束、要不要强制全量、以及要不要对外汇报进度。
 */
async function runDoubanSync(options: DoubanSyncOptions = {}): Promise<JobResult> {
  // 以下三种都属于「没真正抓取」：连一个请求都没发出去。
  // 统一标 skipped，调度器不会把这轮算进 6 小时间隔，
  // 于是总开关一开 / 配置一补好，下一轮 tick 就能立刻抓。
  if (!options.force && !getSetting("sync.enabled")) {
    return { skipped: true, message: "同步开关已关闭，跳过" };
  }
  const uid = String(getSetting("douban.uid") ?? "").trim();
  if (!uid) {
    return { skipped: true, message: "未配置豆瓣用户 ID，跳过抓取" };
  }
  if (!hasTmdbKey()) {
    return { skipped: true, message: "未配置 TMDB_API_KEY，无法匹配作品元数据" };
  }

  const stats = { itemsSeen: 0, itemsNew: 0, itemsUpdated: 0, errorCount: 0 };

  /** 记录一条可复现的错误，供设置页排查。reason 取值受表约束限制。 */
  const issue = (
    reason: "no_match" | "low_score" | "network" | "parse" | "blocked",
    refId: string | null,
    title: string | null,
    detail: string,
  ) => {
    stats.errorCount += 1;
    db.insert(syncIssue)
      .values({
        kind: "douban-html",
        refId,
        title,
        reason,
        detail: detail.slice(0, 500),
      })
      .run();
  };

  /**
   * 处理列表页的一条条目：匹配 → 补 TMDB 详情 → 落库。
   * 返回 true 表示这条记录此前已在库里、且元数据齐全——
   * 调用方据此判断这一页已经没有新东西，可以早停。
   */
  const processItem = async (item: ListPageItem, status: ViewStatus): Promise<boolean> => {
    stats.itemsSeen += 1;
    const { doubanId, titleCn } = item;
    if (!doubanId) {
      issue("parse", null, titleCn, "列表页条目缺少 subject id");
      return false;
    }

    const sourceKey = `douban:${doubanId}`;
    const existingRecord = db
      .select({ id: viewRecord.id, workId: viewRecord.workId })
      .from(viewRecord)
      .where(eq(viewRecord.sourceKey, sourceKey))
      .get();

    // 条目当前指向的作品：优先记录上挂着的 work，其次按豆瓣 id 直接找。
    // 多季条目只有「代表季」的 id 落在 work.doubanId 上，其余靠记录关联。
    const linkedWork =
      (existingRecord?.workId != null
        ? db.select().from(work).where(eq(work.id, existingRecord.workId)).get()
        : undefined) ?? db.select().from(work).where(eq(work.doubanId, doubanId)).get();

    let workId = linkedWork?.id ?? null;

    // 手动绑定的条目不再自动改写；元数据已齐的条目跳过 TMDB 调用
    if (linkedWork?.matchStatus !== "manual" && !isMetadataComplete(linkedWork)) {
      const resolved = await resolveWork(item, issue);
      if (resolved !== null) workId = resolved;
    }

    const season = parseSeasonNumber(titleCn);
    const values = {
      workId,
      source: "douban",
      sourceItemId: doubanId,
      status,
      // 「在看」页的日期是「开始看」，写 startedAt 才不会被概览时间线当成看完；
      // 想看/看过写的都是标记日期
      ...(status === "watching" ? { startedAt: item.markedAt } : { watchedAt: item.markedAt }),
      // 想看/在看页没有评分，null 不能拿去覆盖用户已有的评分
      ...(status === "watched" || item.rating !== null ? { rating: item.rating } : {}),
      ...(item.comment !== null ? { comment: item.comment } : {}),
      // 豆瓣一季一条记录，季号落在记录上，详情页据此按季展示；
      // 标题里没有季标识的条目不写，避免覆盖手工填的进度
      ...(season !== null ? { progressSeason: season } : {}),
    };

    // sourceKey 上的唯一索引保证重跑只更新不新增
    db.insert(viewRecord)
      .values({ sourceKey, ...values })
      .onConflictDoUpdate({ target: viewRecord.sourceKey, set: values })
      .run();

    if (existingRecord) stats.itemsUpdated += 1;
    else stats.itemsNew += 1;

    // 「匹配失败」的元数据不算齐全，不能作为早停依据，否则卡在首页永远重试不了
    return existingRecord !== undefined && isMetadataComplete(linkedWork);
  };

  /* ------------------------------ 抓取主循环 ------------------------------ */

  // 三种情况要完整翻页：首次运行（没有全量时间戳）、距上次满一周、手动触发
  const full = options.full === true || isFullSyncDue();

  // 「看过」是主列表必抓；两个小列表各有开关。
  // filter 只删项不重排，想看 → 在看 → 看过的覆盖优先级仍由 LISTS 保证。
  const enabledLists = LISTS.filter((list) => {
    if (list.status === "wish") return getSetting("douban.syncWish");
    if (list.status === "watching") return getSetting("douban.syncWatching");
    return true;
  });

  // 预热：先拿到 bid 等基础 Cookie，首屏直接请求容易被判为异常流量
  await req(`${DOUBAN_ORIGIN}/`);

  let stopped: string | null = null;
  let totalSum = 0;
  let totalKnown = false;

  for (const list of enabledLists) {
    const label = VIEW_STATUS_LABELS[list.status];
    let processed = 0;
    let start = 0;
    let blockedAtFirstPage = false;

    while (start <= MAX_START) {
      const url = listUrl(uid, list.path, start);
      // 翻页之间必须留随机间隔，否则整轮节奏过于机械
      if (start > 0) await sleep(randomInt(PAGE_GAP_MIN_MS, PAGE_GAP_MAX_MS));

      const page = await req(url);
      const pageNo = start / LIST_PAGE_SIZE + 1;
      if (page.status !== 200 || isBlocked(page.text) || needsLogin(page.text)) {
        issue("blocked", null, null, `${label}列表第 ${pageNo} 页受限 status=${page.status}`);
        blockedAtFirstPage = start === 0;
        stopped = blockedAtFirstPage
          ? `豆瓣拒绝访问（${label}列表首页即受限），本轮中止`
          : `${label}列表第 ${pageNo} 页起被拒绝访问，本轮提前结束`;
        break;
      }

      const html = page.text;
      archiveRaw({ url, kind: "list", body: html, parserVersion: PARSER_VERSION });

      const pageTotal = parseListTotal(html);
      if (pageTotal !== null && start === 0) {
        totalSum += pageTotal;
        totalKnown = true;
      }

      const items = parseListPage(html);
      if (items.length === 0) break; // 翻到末页

      // 早停信号：这一页里出现了库里已有且元数据齐全的条目。
      // 不立刻跳出，是因为同页可能还夹着「匹配失败」待重试的条目，得一并处理掉。
      let sawKnown = false;
      for (const item of items) {
        try {
          if (await processItem(item, list.status)) sawKnown = true;
        } catch (error) {
          // 单条失败不应中断整轮同步
          issue("parse", item.doubanId, item.titleCn, error instanceof Error ? error.message : String(error));
        }
      }

      processed += items.length;
      options.onProgress?.({ seen: stats.itemsSeen, total: totalKnown ? totalSum : null });

      start += LIST_PAGE_SIZE;
      // 增量轮：首页见到已知条目就说明后面只会更旧，不必再翻
      if (!full && sawKnown) break;
      if (pageTotal !== null && processed >= pageTotal) break;
      if (items.length < LIST_PAGE_SIZE) break; // 不满一页即末页
    }

    if (blockedAtFirstPage) break; // 首页都不通，后面的列表同样抓不到
  }

  // 完整跑完才记全量时间戳；中途被拦的话下周之前的常规轮仍是增量，不影响正确性
  if (full && stopped === null) setSetting("douban.lastFullSyncAt", new Date().toISOString());

  const mode = full ? "全量" : "增量";
  const summary = `${mode}同步共 ${stats.itemsSeen} 条（新增 ${stats.itemsNew} / 更新 ${stats.itemsUpdated}），错误 ${stats.errorCount} 条`;
  if (stopped) return failure(stats, stopped);
  return { ...stats, message: summary };
}

/**
 * 是否该做完整回扫。常规轮只抓每个列表的首页就早停，
 * 用户事后修改的老评分/短评只能靠每周一次的全量发现。
 */
function isFullSyncDue(): boolean {
  const last = String(getSetting("douban.lastFullSyncAt") ?? "").trim();
  if (!last) return true; // 从没全量过
  const at = Date.parse(last);
  if (Number.isNaN(at)) return true;
  return Date.now() - at >= FULL_SYNC_INTERVAL_MS;
}

/* -------------------------------------------------------------------------- */
/*                            单条条目的元数据解析                             */
/* -------------------------------------------------------------------------- */

type IssueReporter = (
  reason: "no_match" | "low_score" | "network" | "parse" | "blocked",
  refId: string | null,
  title: string | null,
  detail: string,
) => void;

/**
 * 元数据是否已补齐、无需再调 TMDB。
 * 匹配失败的条目不算完成——策略修好后要能自动重试；
 * 剧集还要求 seasons_json 非空，以便旧数据补上季结构；
 * 国家与主演是后加的字段，旧数据两者皆空，这里一并要求，
 * 否则这一轮同步不会去补，界面上就永远看不到。
 * 判「两者皆空」而非「任一为空」：都填过一次就不再重拉，
 * 免得某部片恰好没有其中一个字段时每轮都白跑一趟 TMDB。
 */
function isMetadataComplete(row: typeof work.$inferSelect | undefined): boolean {
  if (!row) return false;
  if (row.matchStatus !== "matched" && row.matchStatus !== "manual") return false;
  if (!row.metadataSyncedAt) return false;
  if (row.mediaType === "tv" && row.tmdbId !== null && row.seasonsJson === "[]") return false;
  // 国家与主演都空 ⇒ 是老数据（当年还不抓这两项），需要重拉一次
  if (row.countries === "[]" && row.cast === "[]") return false;
  return true;
}

/**
 * TMDB 匹配 → 补详情 → 写 work。
 * 返回作品 id；匹配失败也会落一行 matchStatus='failed' 的作品，
 * 这样观影记录不至于因为「暂时匹配不上」而丢失。
 */
async function resolveWork(item: ListPageItem, issue: IssueReporter): Promise<number | null> {
  const { doubanId, titleCn } = item;
  if (!doubanId) return null;

  // 条目之间的节奏控制：TMDB 侧同样需要节流，间隔取自「同步延迟」设置
  await throttle();

  const outcome = await matchWork({ titleCn, aliases: item.aliases, year: item.year });
  let hit: MatchHit | null = null;
  if (outcome.ok) {
    hit = outcome.hit;
  } else {
    issue(outcome.reason, doubanId, titleCn, outcome.detail);
  }

  // 时长/类型/导演等列表页没有的字段，命中后由 TMDB 详情接口补齐
  const detail = hit ? await tmdbDetail(hit.result.mediaType, hit.result.tmdbId) : null;

  const values = buildWorkValues(item, detail, hit, outcome.ok ? null : outcome.score);

  try {
    // 归属顺序：先按 TMDB 作品复用——豆瓣每季一条，靠这里归并成同一部剧；
    // 再按豆瓣条目找（旧数据此时无 tmdbId），最后才新建。
    const { mediaType, tmdbId } = values;
    const byTmdb =
      tmdbId != null
        ? db
            .select()
            .from(work)
            .where(and(eq(work.mediaType, mediaType), eq(work.tmdbId, tmdbId)))
            .get()
        : undefined;
    const byDouban = db.select().from(work).where(eq(work.doubanId, doubanId)).get();
    const existing = byTmdb ?? byDouban;

    if (existing) {
      // doubanId 只留一个代表值，冲突会撞唯一索引，因此沿用已有的
      db.update(work)
        .set({ ...values, doubanId: existing.doubanId ?? values.doubanId })
        .where(eq(work.id, existing.id))
        .run();

      // 该季此前若自成一个作品行（旧数据每季各匹配一次留下的重复），
      // 把它的观影记录改挂到归并后的作品上再删除，避免同一部剧出现两条
      if (byDouban && byDouban.id !== existing.id) {
        db.update(viewRecord).set({ workId: existing.id }).where(eq(viewRecord.workId, byDouban.id)).run();
        db.delete(work).where(eq(work.id, byDouban.id)).run();
      }
      return existing.id;
    }

    return db.insert(work).values(values).returning({ id: work.id }).get().id;
  } catch (error) {
    // 唯一索引冲突（同一 TMDB 作品已绑到别的豆瓣条目）时退化为「只挂记录」
    issue("low_score", doubanId, titleCn, `作品落库失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 把「豆瓣列表页 + TMDB 命中与详情」合并成一行 work。豆瓣字段优先，TMDB 补齐其余。 */
function buildWorkValues(
  item: ListPageItem,
  detail: TmdbDetail | null,
  hit: MatchHit | null,
  failedScore: number | null,
): NewWork {
  const tmdb = hit?.result;
  const isTv = tmdb?.mediaType === "tv";
  const seasons = detail?.seasons ?? [];
  // 整剧年份取第一季首播年，避免各季互相改写
  const firstSeasonYear = seasons[0]?.airDate ? Number(seasons[0].airDate.slice(0, 4)) || null : null;

  return {
    mediaType: tmdb?.mediaType ?? guessMediaType(item.titleCn),
    tmdbId: tmdb?.tmdbId ?? null,
    doubanId: item.doubanId,
    // 剧集用整剧名（剥掉「第X季」），多季条目才能收敛到同一行
    title: isTv ? baseTitleOf(item.titleCn) : item.titleCn,
    originalTitle: tmdb?.originalTitle ?? item.aliases[0] ?? null,
    // 豆瓣年份是「该季」的年份，仅电影直接沿用
    year: isTv ? firstSeasonYear ?? tmdb?.year ?? item.year ?? null : item.year ?? tmdb?.year ?? null,
    // 主海报用 TMDB 整剧海报，不用季海报
    posterPath: detail?.posterPath ?? tmdb?.posterPath ?? null,
    backdropPath: tmdb?.backdropPath ?? null,
    overview: tmdb?.overview ?? null,
    // 剧集为单集时长
    runtime: detail?.runtime ?? null,
    seasonCount: isTv ? detail?.seasonCount ?? (seasons.length || null) : null,
    episodeCount: isTv ? detail?.episodeCount ?? null : null,
    seasonsJson: JSON.stringify(seasons),
    releaseDate: detail?.releaseDate ?? tmdb?.releaseDate ?? null,
    imdbId: detail?.imdbId ?? null,
    genres: JSON.stringify(detail?.genres ?? []),
    // 豆瓣列表页的国家解析常年不稳，TMDB 有结果时以它为准，豆瓣仅兜底
    countries: JSON.stringify(detail?.countries?.length ? detail.countries : item.country ? [item.country] : []),
    languages: "[]",
    directors: JSON.stringify(detail?.directors ?? []),
    cast: JSON.stringify(detail?.cast ?? []),
    matchStatus: hit ? "matched" : "failed",
    matchStrategy: hit?.strategy ?? null,
    matchScore: hit?.score ?? failedScore,
    metadataSyncedAt: new Date(),
  };
}

function failure(
  stats: { itemsSeen: number; itemsNew: number; itemsUpdated: number; errorCount: number },
  message: string,
): JobResult {
  return { ...stats, partial: true, message };
}
