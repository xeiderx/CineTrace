import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { syncIssue, viewRecord, work, type NewWork } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { archiveRaw } from "@/lib/douban/archive";
import { isBlocked, needsLogin, req } from "@/lib/douban/client";
import { PARSER_VERSION, parseCollectTotal, parseListPage, type ListPageItem } from "@/lib/douban/parse";
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
 * - 增量：列表页每轮全量翻（只花翻页等待），已同步过元数据的条目不再调 TMDB
 * - 整季归并：豆瓣把每一季当作独立条目，这里按 TMDB 的 `(mediaType, tmdbId)`
 *   归到同一行 work，季信息记在 seasons_json，每季仍各自写一条 view_record
 * - 手动优先：matchStatus 为 manual 的条目不再自动改写绑定关系
 * - 不抓详情页：机房 IP 访问豆瓣详情页必被风控拦截，
 *   而匹配只需列表页的「中文名 / 别名 / 年份」，
 *   时长、类型、导演等缺失字段改由 TMDB 详情接口补齐
 */

const DOUBAN_ORIGIN = "https://movie.douban.com";
/** 豆瓣 collect 页固定每页 15 条 */
const COLLECT_PAGE_SIZE = 15;
/**
 * 翻页间隔区间（毫秒）。豆瓣列表页是全量翻的，一轮上百次请求，
 * 所以刻意比 TMDB 侧慢得多；这里取随机区间而非固定值——
 * 固定 5 秒的机械节奏是最典型的机器特征，比等久一点更容易被拦。
 */
const PAGE_GAP_MIN_MS = 5000;
const PAGE_GAP_MAX_MS = 12_000;
/** 400 页上限：防止总数解析异常导致无限翻页 */
const MAX_START = 6000;

/** 未知媒体类型的兜底猜测：带「第X季」标识的按剧集处理。 */
function guessMediaType(titleCn: string): "movie" | "tv" {
  return /第\s*[一二三四五六七八九十\d]+\s*季/.test(titleCn) ? "tv" : "movie";
}

function collectUrl(uid: string, start: number): string {
  return `${DOUBAN_ORIGIN}/people/${encodeURIComponent(uid)}/collect?sort=time&start=${start}`;
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
  onProgress?: (progress: DoubanSyncProgress) => void;
};

export const doubanSyncJob: Job = {
  name: "douban-sync",
  kind: "douban-html",
  intervalMs: 6 * 60 * 60 * 1000,
  // 列表页全量翻，上百页配上 5~12 秒的随机间隔，最坏要跑半小时以上；
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
      result = await runDoubanSync({ force: true, onProgress });
      return result;
    },
  };
  return { ran: await runJob(job), result };
}

/**
 * 抓取一轮豆瓣「我看过的」并落库。定时任务与手动同步共用此实现，
 * 差别只在是否受总开关约束、以及要不要对外汇报进度。
 */
async function runDoubanSync(options: DoubanSyncOptions = {}): Promise<JobResult> {
  if (!options.force && !getSetting("sync.enabled")) {
    return { message: "同步开关已关闭，跳过" };
  }
  const uid = String(getSetting("douban.uid") ?? "").trim();
  if (!uid) {
    return { partial: true, message: "未配置豆瓣用户 ID，跳过抓取" };
  }
  if (!hasTmdbKey()) {
    return { partial: true, message: "未配置 TMDB_API_KEY，无法匹配作品元数据" };
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

  /** 处理列表页的一条条目：匹配 → 补 TMDB 详情 → 落库。 */
  const processItem = async (item: ListPageItem) => {
    stats.itemsSeen += 1;
    const { doubanId, titleCn } = item;
    if (!doubanId) {
      issue("parse", null, titleCn, "列表页条目缺少 subject id");
      return;
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
      status: "watched" as const,
      watchedAt: item.markedAt,
      rating: item.rating,
      comment: item.comment,
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
  };

  /* ------------------------------ 抓取主循环 ------------------------------ */

  // 预热：先拿到 bid 等基础 Cookie，首屏直接请求容易被判为异常流量
  await req(`${DOUBAN_ORIGIN}/`);

  const firstUrl = collectUrl(uid, 0);
  const first = await req(firstUrl);
  if (first.status !== 200 || isBlocked(first.text) || needsLogin(first.text)) {
    issue("blocked", null, null, `列表页首页不可用 status=${first.status}`);
    return failure(stats, "豆瓣拒绝访问（首页即受限），本轮中止");
  }

  const total = parseCollectTotal(first.text);
  let html = first.text;
  let processed = 0;
  let start = 0;
  let stopped: string | null = null;

  while (start <= MAX_START) {
    const url = collectUrl(uid, start);
    if (start > 0) {
      await sleep(randomInt(PAGE_GAP_MIN_MS, PAGE_GAP_MAX_MS));
      const page = await req(url);
      if (page.status !== 200 || isBlocked(page.text) || needsLogin(page.text)) {
        issue("blocked", null, null, `列表页第 ${start / COLLECT_PAGE_SIZE + 1} 页受限 status=${page.status}`);
        stopped = `列表页第 ${start / COLLECT_PAGE_SIZE + 1} 页起被拒绝访问，本轮提前结束`;
        break;
      }
      html = page.text;
    }

    archiveRaw({ url, kind: "list", body: html, parserVersion: PARSER_VERSION });

    const items = parseListPage(html);
    if (items.length === 0) break; // 翻到末页

    for (const item of items) {
      try {
        await processItem(item);
      } catch (error) {
        // 单条失败不应中断整轮同步
        issue("parse", item.doubanId, item.titleCn, error instanceof Error ? error.message : String(error));
      }
    }

    processed += items.length;
    options.onProgress?.({ seen: stats.itemsSeen, total });
    start += COLLECT_PAGE_SIZE;
    if (total !== null && processed >= total) break;
    if (items.length < COLLECT_PAGE_SIZE) break; // 不满一页即末页
  }

  const summary = `共 ${stats.itemsSeen} 条（新增 ${stats.itemsNew} / 更新 ${stats.itemsUpdated}），错误 ${stats.errorCount} 条`;
  if (stopped) return failure(stats, stopped, start);
  return { ...stats, cursor: String(start), message: summary };
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
  cursor: number | null = null,
): JobResult {
  return { ...stats, cursor: cursor === null ? null : String(cursor), partial: true, message };
}
