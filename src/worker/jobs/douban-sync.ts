import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncIssue, viewRecord, work, type NewWork } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { archiveRaw } from "@/lib/douban/archive";
import { fetchWithPow, isBlocked, needsLogin, req } from "@/lib/douban/client";
import {
  PARSER_VERSION,
  parseCollectTotal,
  parseListPage,
  parseSubject,
  type ListPageItem,
  type SubjectDetail,
} from "@/lib/douban/parse";
import { hasTmdbKey, matchWork, type MatchHit } from "@/lib/tmdb";
import type { Job, JobResult } from "../job";
import { sleep, throttle } from "../throttle";

/**
 * 豆瓣同步主任务：把 Phase 0 验证过的链路正式产品化。
 *
 * 抓取 → 解析 → TMDB 匹配 → 落 work/view_record → 归档 + 错误记录。
 *
 * 关键设计：
 * - 幂等：view_record.sourceKey = `douban:{id}`，重跑不会产生重复记录
 * - 增量：仅对「尚无元数据」的条目抓详情页 + 调 TMDB，
 *   列表页每轮全量翻（只花翻页等待），详情页只在首次出现时抓一次
 * - 手动优先：matchStatus 为 manual 的条目不再自动改写绑定关系
 */

const DOUBAN_ORIGIN = "https://movie.douban.com";
/** 豆瓣 collect 页固定每页 15 条 */
const COLLECT_PAGE_SIZE = 15;
/** 翻页间隔，Phase 0 实测节奏 */
const PAGE_GAP_MS = 5000;
/** 400 页上限：防止总数解析异常导致无限翻页 */
const MAX_START = 6000;

/** 未知媒体类型的兜底猜测：带「第X季」标识的按剧集处理。 */
function guessMediaType(titleCn: string): "movie" | "tv" {
  return /第\s*[一二三四五六七八九十\d]+\s*季/.test(titleCn) ? "tv" : "movie";
}

/** 豆瓣的上映日带着地区后缀（如 `2024-01-01(中国大陆)`），只取日期部分。 */
function isoDate(raw: string | null): string | null {
  const m = raw?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function collectUrl(uid: string, start: number): string {
  return `${DOUBAN_ORIGIN}/people/${encodeURIComponent(uid)}/collect?sort=time&start=${start}`;
}

function subjectUrl(doubanId: string): string {
  return `${DOUBAN_ORIGIN}/subject/${doubanId}/`;
}

export const doubanSyncJob: Job = {
  name: "douban-sync",
  kind: "douban-html",
  intervalMs: 6 * 60 * 60 * 1000,
  // 2100 条记录分页抓取耗时较长，锁的存活时间给足
  lockTtlMs: 30 * 60 * 1000,
  async run() {
    if (!getSetting("sync.enabled")) {
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

    /** 处理列表页的一条条目：补详情 → 匹配 → 落库。 */
    const processItem = async (item: ListPageItem) => {
      stats.itemsSeen += 1;
      const { doubanId, titleCn } = item;
      if (!doubanId) {
        issue("parse", null, titleCn, "列表页条目缺少 subject id");
        return;
      }

      const sourceKey = `douban:${doubanId}`;
      const existingRecord = db
        .select({ id: viewRecord.id })
        .from(viewRecord)
        .where(eq(viewRecord.sourceKey, sourceKey))
        .get();
      const existingWork = db.select().from(work).where(eq(work.doubanId, doubanId)).get();

      let workId = existingWork?.id ?? null;

      // 手动绑定的条目不再自动改写；已有元数据的条目跳过详情页与 TMDB 调用
      const manuallyBound = existingWork?.matchStatus === "manual";
      if (!manuallyBound && !existingWork?.metadataSyncedAt) {
        const resolved = await resolveWork(item, issue);
        if (resolved) workId = resolved;
      } else if (existingWork) {
        db.update(work)
          .set({ metadataSyncedAt: new Date() })
          .where(eq(work.id, existingWork.id))
          .run();
      }

      const values = {
        workId,
        source: "douban",
        sourceItemId: doubanId,
        status: "watched" as const,
        watchedAt: item.markedAt,
        rating: item.rating,
        comment: item.comment,
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
        await sleep(PAGE_GAP_MS);
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
      start += COLLECT_PAGE_SIZE;
      if (total !== null && processed >= total) break;
      if (items.length < COLLECT_PAGE_SIZE) break; // 不满一页即末页
    }

    const summary = `共 ${stats.itemsSeen} 条（新增 ${stats.itemsNew} / 更新 ${stats.itemsUpdated}），错误 ${stats.errorCount} 条`;
    if (stopped) return failure(stats, stopped, start);
    return { ...stats, cursor: String(start), message: summary };
  },
};

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
 * 抓详情页 → TMDB 匹配 → 写 work。
 * 返回作品 id；匹配失败也会落一行 matchStatus='failed' 的作品，
 * 这样观影记录不至于因为「暂时匹配不上」而丢失。
 */
async function resolveWork(item: ListPageItem, issue: IssueReporter): Promise<number | null> {
  const { doubanId, titleCn } = item;
  if (!doubanId) return null;

  let detail: SubjectDetail | null = null;
  const detailUrl = subjectUrl(doubanId);

  await throttle();
  try {
    const { res } = await fetchWithPow(detailUrl);
    if (isBlocked(res.text)) {
      issue("blocked", doubanId, titleCn, "详情页被风控拦截");
      return null;
    }
    if (res.status !== 200) {
      issue("network", doubanId, titleCn, `详情页 status=${res.status}`);
      return null;
    }
    const parsed = parseSubject(res.text);
    if (!parsed.hasInfo) {
      issue("parse", doubanId, titleCn, "详情页缺少 #info 区块，疑似改版或空页");
      return null;
    }
    detail = parsed;
    archiveRaw({ url: detailUrl, kind: "detail", body: res.text, parserVersion: PARSER_VERSION });
  } catch (error) {
    issue("network", doubanId, titleCn, error instanceof Error ? error.message : String(error));
    return null;
  }

  const outcome = await matchWork({ titleCn, aliases: item.aliases, year: item.year });
  let hit: MatchHit | null = null;
  if (outcome.ok) {
    hit = outcome.hit;
  } else {
    issue(outcome.reason, doubanId, titleCn, outcome.detail);
  }

  const values = buildWorkValues(item, detail, hit, outcome.ok ? null : outcome.score);
  const existing = db.select({ id: work.id }).from(work).where(eq(work.doubanId, doubanId)).get();

  try {
    if (existing) {
      db.update(work).set(values).where(eq(work.id, existing.id)).run();
      return existing.id;
    }
    return db.insert(work).values(values).returning({ id: work.id }).get().id;
  } catch (error) {
    // 唯一索引冲突（同一 TMDB 作品已绑到别的豆瓣条目）时退化为「只挂记录」
    issue("low_score", doubanId, titleCn, `作品落库失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 把「豆瓣列表页 + 详情页 + TMDB 命中」合并成一行 work。豆瓣字段优先，TMDB 补齐其余。 */
function buildWorkValues(
  item: ListPageItem,
  detail: SubjectDetail | null,
  hit: MatchHit | null,
  failedScore: number | null,
): NewWork {
  const tmdb = hit?.result;
  return {
    mediaType: tmdb?.mediaType ?? guessMediaType(item.titleCn),
    tmdbId: tmdb?.tmdbId ?? null,
    doubanId: item.doubanId,
    title: detail?.title || item.titleCn,
    originalTitle: tmdb?.originalTitle ?? item.aliases[0] ?? null,
    // 豆瓣年份是「标记来源」的年份，比 TMDB 更贴近匹配目标
    year: item.year ?? detail?.year ?? tmdb?.year ?? null,
    posterPath: tmdb?.posterPath ?? null,
    backdropPath: tmdb?.backdropPath ?? null,
    overview: tmdb?.overview ?? null,
    runtime: detail?.runtime ?? null,
    releaseDate: isoDate(detail?.releaseDate ?? null) ?? tmdb?.releaseDate ?? null,
    imdbId: detail?.imdbId ?? null,
    genres: JSON.stringify(detail?.genres ?? []),
    countries: JSON.stringify(item.country ? [item.country] : []),
    languages: "[]",
    directors: JSON.stringify(detail?.directors ?? []),
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
