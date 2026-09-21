import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { syncIssue, viewEpisode, viewRecord, work, type NewWork } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { VIEW_STATUS_LABELS, type ViewStatus } from "@/lib/labels";
import { parseManualFields } from "@/lib/watch-progress";
import { archiveRaw } from "@/lib/douban/archive";
import { isBlocked, needsLogin, req } from "@/lib/douban/client";
import { PARSER_VERSION, parseHasNext, parseListPage, parseListTotal, type ListPageItem } from "@/lib/douban/parse";
import { parseSeasons } from "@/lib/queries";
import {
  baseTitleOf,
  hasTmdbKey,
  matchWork,
  parseSeasonHint,
  parseSeasonNumber,
  tmdbDetail,
  type MatchHit,
  type TmdbDetail,
} from "@/lib/tmdb";
import { runJob, type Job, type JobResult } from "../job";
import { isWithinWindow, randomInt, sleep, throttle } from "../throttle";

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

/** 一轮同步的模式：全量完整翻页，或只翻每个列表首页就早停 */
export type DoubanSyncMode = "full" | "incremental";

type DoubanSyncOptions = {
  /** 手动同步时忽略 sync.enabled 总开关 */
  force?: boolean;
  /**
   * 指定这一轮的模式。不传则由「距上次全量是否满一周」自动决定——
   * 手动入口要尊重用户点的是哪个按钮：点增量就只翻首页，
   * 哪怕恰好到了每周全量的时候，也只把全量让给下一轮定时任务。
   */
  mode?: DoubanSyncMode;
  /** 这一轮是否由用户手动触发。冷却时间戳只对手动轮有意义 */
  manual?: boolean;
  onProgress?: (progress: DoubanSyncProgress) => void;
};

export const doubanSyncJob: Job = {
  name: "douban-sync",
  kind: "douban-html",
  intervalMs: 6 * 60 * 60 * 1000,
  // 锁的初值只保证「进得去、拿得住」，实际时长由 withLock 每 TTL/3 续租兜住：
  // 首次全量要回扫两千多条、逐条等 TMDB（每条 3~8 秒）＋上百页 5~12 秒翻页间隔，
  // 实测量级是数小时；后续全量元数据已齐，只剩翻页间隔，几十分钟即可跑完。
  // 单靠一个够大的静值 TTL 覆盖不了这两种差别极大的耗时，所以必须续租。
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
  mode: DoubanSyncMode = "full",
): Promise<{ ran: boolean; result: JobResult | null }> {
  let result: JobResult | null = null;
  const job: Job = {
    ...doubanSyncJob,
    run: async () => {
      result = await runDoubanSync({ force: true, mode, manual: true, onProgress });
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

  /**
   * 本轮在豆瓣列表上实际见到的 sourceKey。仅用于全量轮跑完后判定「哪些本地记录
   * 已经不在豆瓣列表里了」——豆瓣删除/合并/转私密的条目不会给出任何信号，
   * 只能靠「整轮翻完都没见到」来反推。
   */
  const seenSourceKeys = new Set<string>();

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
    // 先登记「见到过」再走后面可能抛错的落地流程：条目确实还在豆瓣列表上，
    // 就不该因为这一条本地处理失败而被当成「已移除」
    seenSourceKeys.add(sourceKey);
    const existingRecord = db
      .select({
        id: viewRecord.id,
        workId: viewRecord.workId,
        status: viewRecord.status,
        watchedAt: viewRecord.watchedAt,
        manualFieldsJson: viewRecord.manualFieldsJson,
      })
      .from(viewRecord)
      .where(eq(viewRecord.sourceKey, sourceKey))
      .get();

    // 用户在详情页手动改过的字段以本地为准，本轮同步不覆盖它们。
    // 想重新跟随豆瓣的，在详情页点「恢复跟随豆瓣」把字段解锁即可。
    const locked = new Set(parseManualFields(existingRecord?.manualFieldsJson));
    const unlocked = (field: string) => !locked.has(field);

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

    const season = resolveProgressSeason(titleCn, workId);
    // 状态被锁定时以本地为准：用户把某条改成「弃剧」后，不该因为豆瓣还在 collect 列表
    // 就被改回「看过」。锁定之外的情况仍跟豆瓣走。
    const finalStatus = unlocked("status") ? status : existingRecord?.status ?? status;
    // 豆瓣三个列表互斥，把「看过」改成「想看」时条目会离开 collect 列表。
    // 状态跟豆瓣走，但原有的看过日期不能被这次改动抹掉——那是真实看过的时间，
    // 以后二刷三刷还要靠它回溯。所以非「看过」的列表只在记录还没有日期时才写入。
    const keepWatchedAt = finalStatus !== "watched" && existingRecord?.watchedAt != null;
    const values = {
      workId,
      source: "douban",
      sourceItemId: doubanId,
      status: finalStatus,
      // 「在看」页的日期是「开始看」，写 startedAt 才不会被概览时间线当成看完；
      // 「看过」页的日期既是标记日也是看完日，额外落到 finishedAt，
      // 详情页的季结束时间才有来源（逐集记录缺失时靠它兜底）。
      ...(finalStatus === "watching"
        ? unlocked("startedAt")
          ? { startedAt: item.markedAt }
          : {}
        : keepWatchedAt || !unlocked("watchedAt")
          ? {}
          : { watchedAt: item.markedAt }),
      // 条目落在「看过」列表时，豆瓣那个标记日同时也是看完日。
      // 判据用豆瓣的列表归属（status）而不是生效状态：状态被锁成别的值时，
      // 这一条仍然是豆瓣给出的「已看完」事实，看完日期照旧可信。
      ...(status === "watched" && unlocked("finishedAt")
        ? { finishedAt: item.markedAt }
        : {}),
      // 想看/在看页没有评分与短评，null 不能拿去覆盖用户已有的值；
      // 「看过」列表才代表豆瓣给出的权威值，但用户手动改过时仍以本地为准。
      ...(unlocked("rating") && (status === "watched" || item.rating !== null)
        ? { rating: item.rating }
        : {}),
      ...(unlocked("comment") && (status === "watched" || item.comment !== null)
        ? { comment: item.comment }
        : {}),
      // 豆瓣一季一条记录，季号落在记录上，详情页据此按季展示；
      // 标题里没有季标识的条目不写，避免覆盖手工填的进度
      ...(unlocked("progressSeason") && season !== null ? { progressSeason: season } : {}),
      // 条目重新出现在列表上，之前打的「已移除」标记必须撤掉
      doubanRemovedAt: null,
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

  // 模式判定：手动轮由按钮决定，自动轮靠「距上次全量是否满一周」判断
  const full = options.mode ? options.mode === "full" : isFullSyncDue();
  const mode = full ? "全量" : "增量";

  // 「看过」是主列表必抓；两个小列表各有开关。
  // filter 只删项不重排，想看 → 在看 → 看过的覆盖优先级仍由 LISTS 保证。
  const enabledLists = LISTS.filter((list) => {
    if (list.status === "wish") return getSetting("douban.syncWish");
    if (list.status === "watching") return getSetting("douban.syncWatching");
    return true;
  });

  // 预热：先拿到 bid 等基础 Cookie，首屏直接请求容易被判为异常流量
  await req(`${DOUBAN_ORIGIN}/`);

  // 断点续跑：上一轮撞上作息窗口结束时留下的位置。只有全量轮才认游标——
  // 增量轮本来就只翻首页，从半途开始毫无意义，反而会漏掉最新条目。
  // 游标只对「暂停时所在的那个列表」生效，它之前的列表照旧从第 1 页抓：
  // 那些列表上轮已经抓完，重抓一遍是幂等的（只多几次请求），
  // 换来的是「续跑期间改了列表开关也绝不会漏抓」——若按游标直接跳过前面的列表，
  // 中途把想看打开就会让这个列表一直抓到下次全量为止。
  const cursor = full ? parseCursor(String(getSetting("douban.syncCursor") ?? "").trim()) : null;

  let stopped: string | null = null;
  let totalSum = 0;
  let totalKnown = false;
  /**
   * 豆瓣「看过」列表声明的总条数。它与本地记录数的差额另有含义——
   * 豆瓣把它删除/合并的条目仍计入总数、但不再出现在列表里，所以本地永远抓不全。
   * 记下来供概览页解释这个差额，不参与任何抓取判定。
   */
  let watchedDeclaredTotal: number | null = null;
  /** 因作息窗口结束而暂停的位置；与「被豆瓣拒绝」不同，下一轮直接续跑 */
  let pausedAt: { status: ViewStatus; start: number } | null = null;
  /**
   * 「看过」列表这一轮是否从第 1 页一路翻到了真实末页。
   * 只有这种完整的一轮才拿得到全量条目，才能反推「哪些记录已不在豆瓣列表里」；
   * 续跑（从断点页起）与被拒/暂停（剩下没翻）都不算。
   */
  let watchedTraversed = false;

  for (const list of enabledLists) {
    const label = VIEW_STATUS_LABELS[list.status];
    // 游标命中当前列表时从断点页起抓；命中的是别的列表就照常从第 1 页起抓。
    // 续跑时 processed 一并从断点开始计数：它要和列表总条数比，用来判断是否翻到底
    const listStart = cursor !== null && cursor.status === list.status ? cursor.start : 0;
    let start = listStart;
    let processed = start;
    let blockedAtFirstPage = false;
    /** 这一列表是否翻到了真实末页（而非被拒、暂停或撞上 MAX_START 截断） */
    let reachedEnd = false;

    while (start <= MAX_START) {
      // 作息窗口只在任务启动前由调度器检查一次，跑起来之后就没人管了。
      // 首次全量要数小时，傍晚开跑会一路抓到凌晨——连续数小时不间断的请求
      // 才是真正像机器的特征。这里每翻一页查一次，出窗就记下断点、本轮中止，
      // 下一轮（仍是全量）从断点页接着跑，绝不跨夜。
      // 只对全量轮生效：增量轮本来就只翻几页，分钟级就跑完，没有必要为它留断点
      // （留了反而会在下次全量时把前面的列表一并跳过）。
      if (full && !isWithinWindow()) {
        pausedAt = { status: list.status, start };
        break;
      }

      const url = listUrl(uid, list.path, start);
      // 翻页之间必须留随机间隔，否则整轮节奏过于机械
      if (start > 0) await sleep(randomInt(PAGE_GAP_MIN_MS, PAGE_GAP_MAX_MS));

      const page = await req(url);
      const pageNo = start / LIST_PAGE_SIZE + 1;
      if (page.status !== 200 || isBlocked(page.text) || needsLogin(page.text)) {
        issue("blocked", null, null, `${label}列表第 ${pageNo} 页受限 status=${page.status}`);
        blockedAtFirstPage = start === listStart;
        stopped = blockedAtFirstPage
          ? `豆瓣拒绝访问（${label}列表首页即受限），本轮中止`
          : `${label}列表第 ${pageNo} 页起被拒绝访问，本轮提前结束`;
        break;
      }

      const html = page.text;
      archiveRaw({ url, kind: "list", body: html, parserVersion: PARSER_VERSION });

      // 每个列表只在它的首页累加一次总数，避免翻页过程中重复计数
      const pageTotal = parseListTotal(html);
      if (pageTotal !== null && start === listStart) {
        totalSum += pageTotal;
        totalKnown = true;
      }
      // 「看过」的声明总数单独记一份。它不像上面那样要求首页——续跑时首页被跳过，
      // 而这一页的 h1 里同样带着同一个数字，取到即可。
      if (pageTotal !== null && list.status === "watched") {
        watchedDeclaredTotal = pageTotal;
      }

      const items = parseListPage(html);
      if (items.length === 0) {
        reachedEnd = true; // 翻到末页
        break;
      }
      const hasNext = parseHasNext(html);

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
      if (pageTotal !== null && processed >= pageTotal) {
        reachedEnd = true; // 声明的条数都已翻完
        break;
      }
      // 末页判定以分页器的「后页」链接为准。
      // 不满一页不能当末页——豆瓣在条目被删或转私密时会给出 14 条的中间页，
      // 早期按短页退出导致列表被截断在 119 条（总数其实有 2198）。
      if (hasNext === false) {
        reachedEnd = true;
        break;
      }
      // 分页器结构异常时只能按短页兜底：这种「猜」出来的末页不足以支撑
      // 「已移除」判定，所以不置 reachedEnd。
      if (hasNext === null && items.length < LIST_PAGE_SIZE) break;
    }

    // 必须从第 1 页起翻且翻到末页，seenSourceKeys 才真正覆盖整份「看过」列表。
    // 续跑轮（listStart > 0）只翻了后半段，前半段这一轮压根没见过，
    // 拿去比对会把上千条正常记录误标成已移除。
    if (list.status === "watched" && listStart === 0 && !blockedAtFirstPage) {
      watchedTraversed = reachedEnd;
    }

    if (pausedAt !== null) break; // 出窗了，后面的列表留给下一轮
    if (blockedAtFirstPage) break; // 首页都不通，后面的列表同样抓不到
  }

  // 豆瓣声明的「看过」总数任何时候都照实记下，与这轮是否跑完无关：
  // 它只是对端的一个说法，用来解释「本地记录数为何比豆瓣少几条」，
  // 不参与断点/冷却这类需要「真跑完」才敢写的判定。
  // 增量轮也会抓「看过」首页，所以这个数字一样能保持新鲜。
  if (watchedDeclaredTotal !== null) {
    setSetting("douban.lastWatchedTotal", watchedDeclaredTotal);
  }

  // 出窗暂停：记下断点，本轮标 partial 且不写全量时间戳，
  // 于是下一轮仍是全量、读到游标从断点续跑。
  // 但断点未必比已有游标更靠后：列表是按顺序抓的，若在「更靠前」的列表上撞墙
  // （上一轮停在 watched:315，这一轮刚翻 wish 首页就到点），写进去会把
  // watched 的进度冲掉，下次得从第 1 页重翻三百页。此时保留旧游标更划算。
  // 列表顺序即序号，「靠前」= 序号更小。
  if (pausedAt !== null) {
    const pausedOrder = LISTS.findIndex((item) => item.status === pausedAt.status);
    const cursorOrder = cursor === null ? -1 : LISTS.findIndex((item) => item.status === cursor.status);
    if (pausedOrder >= cursorOrder) {
      setSetting("douban.syncCursor", `${pausedAt.status}:${pausedAt.start}`);
    }
    const label = VIEW_STATUS_LABELS[pausedAt.status];
    return failure(
      stats,
      `${mode}同步已抓 ${stats.itemsSeen} 条，到作息窗口结束，${label}列表中暂停，下次继续`,
    );
  }

  // 只有「整轮全量真的跑完」才清游标、记全量时间戳。
  // 中途被豆瓣拒绝时两者都不动：时间戳不写，于是下一轮仍是全量，
  // 剩下的条目马上就能再翻一遍，而不必等到一周后。
  // 清游标只认全量轮：增量轮根本不会读游标，让它去改这个值只会平白毁掉别处的断点。
  //
  // 手动轮的冷却时间戳同样只认「真跑完」：被拒绝或中途停下时什么都不写，
  // 否则用户会为了一个根本没成的同步白等一小时（增量）或三天（全量）。
  // 全量的 72 小时冷却直接复用 lastFullSyncAt——它的语义就是「最近一次全量完成」，
  // 手动全量成功后刷新它，天然满足「起点是任意一次全量（含自动）」。
  if (full && stopped === null) {
    setSetting("douban.syncCursor", "");
    setSetting("douban.lastFullSyncAt", new Date().toISOString());
  }
  if (options.manual && !full && stopped === null) {
    setSetting("douban.lastManualIncAt", new Date().toISOString());
  }

  // 「豆瓣已移除」标记：只有这轮把「看过」列表从第 1 页完整翻到末页时才敢做。
  // 增量轮只翻首页、续跑轮只翻后半段、被拒或出窗暂停时剩下的页没翻——
  // 这些情况下 seenSourceKeys 都不是全量，拿去比对会大面积误标。
  // 想看/在看两个小列表不参与比对：它们可以单独关掉同步，关掉时条目压根没进集合。
  let removedMarked = 0;
  if (full && watchedTraversed) {
    removedMarked = markDoubanRemoved(seenSourceKeys);
  }

  const summary = `${mode}同步共 ${stats.itemsSeen} 条（新增 ${stats.itemsNew} / 更新 ${stats.itemsUpdated}），错误 ${stats.errorCount} 条${
    removedMarked > 0 ? `，新标记「豆瓣已移除」${removedMarked} 条` : ""
  }`;
  if (stopped) return failure(stats, stopped);
  return { ...stats, message: summary };
}

/**
 * 解析断点游标 `<status>:<start>`。任何不合规的形状都返回 null（当作没有断点），
 * 避免手工改库写坏值时让同步从莫名其妙的位置开始或直接抛错。
 */
function parseCursor(raw: string): { status: ViewStatus; start: number } | null {
  const m = /^(wish|watching|watched):(\d+)$/.exec(raw);
  if (!m) return null;
  const start = Number(m[2]);
  if (!Number.isInteger(start) || start < 0 || start > MAX_START) return null;
  return { status: m[1] as ViewStatus, start };
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

/**
 * 全量翻完一轮后，把本地「看过」记录里本轮没见到的打上「豆瓣已移除」标记。
 *
 * 豆瓣对删除/合并/转私密这三种变动不给任何信号，条目只是从列表里消失，
 * 所以只能反推：整份「看过」列表都翻过了、这一条却不在其中，那它多半已经不在了。
 * 删除/合并/转私密在列表上无法区分，这也是「只标记、不自动删」的原因——
 * 标记可逆，真删了记录里的评分和短评就找不回来了。
 *
 * 只处理「看过」：想看/在看两个小列表可以单独关掉同步，关掉时它们的条目
 * 根本不会进 seenSourceKeys，一并比对会把整个列表误标成已移除。
 * 重新出现的条目会在 processItem 里把标记清掉。
 *
 * @param seen 本轮在豆瓣列表上见到的全部 sourceKey
 * @returns 本轮新打上标记的记录数
 */
function markDoubanRemoved(seen: ReadonlySet<string>): number {
  const candidates = db
    .select({ id: viewRecord.id, sourceKey: viewRecord.sourceKey })
    .from(viewRecord)
    .where(
      and(
        eq(viewRecord.source, "douban"),
        eq(viewRecord.status, "watched"),
        // 已标记过的不用再看：重复写只会把「移除时间」一直往后推
        isNull(viewRecord.doubanRemovedAt),
      ),
    )
    .all();

  const now = new Date();
  let marked = 0;
  for (const row of candidates) {
    if (seen.has(row.sourceKey)) continue;
    db.update(viewRecord).set({ doubanRemovedAt: now }).where(eq(viewRecord.id, row.id)).run();
    marked += 1;
  }
  return marked;
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
 * 主演是后加的字段，旧数据必然为空，这里要求，
 * 否则这一轮同步不会去补，界面上就永远看不到。
 * 判据只用主演：国家当年是从豆瓣列表页写进去的，存量数据里非空，
 * 拿它当判据一条都判不出来。
 */
function isMetadataComplete(row: typeof work.$inferSelect | undefined): boolean {
  if (!row) return false;
  if (row.matchStatus !== "matched" && row.matchStatus !== "manual") return false;
  if (!row.metadataSyncedAt) return false;
  if (row.mediaType === "tv" && row.tmdbId !== null && row.seasonsJson === "[]") return false;
  // 主演为空 ⇒ 是老数据（当年还不抓这项），需要重拉一次
  if (row.cast === "[]") return false;
  return true;
}

/**
 * 决定这条豆瓣条目该记成第几季。
 *
 * 「第X季」是明确写法，直接采信；「模范出租车3」这种结尾数字只是猜测，
 * 要拿作品真实的季列表核对——猜错会让标记挂到别的季上，
 * 而电影标题（《美国队长4》）也长这样，所以类型和季列表缺一不可。
 */
function resolveProgressSeason(titleCn: string, workId: number | null): number | null {
  const explicit = parseSeasonNumber(titleCn);
  if (explicit !== null) return explicit;

  const guess = parseSeasonHint(titleCn);
  if (guess === null || workId === null) return null;

  const row = db
    .select({ mediaType: work.mediaType, seasonsJson: work.seasonsJson })
    .from(work)
    .where(eq(work.id, workId))
    .get();
  if (row?.mediaType !== "tv") return null;

  return parseSeasons(row.seasonsJson).some((s) => s.seasonNumber === guess) ? guess : null;
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
        // 逐集记录也是 cascade，但 (workId, watchIndex, seasonNumber, episodeNumber)
        // 上有唯一索引，直接改 workId 会撞上目标行；先复制，再让删源带走原件。
        const episodes = db
          .select({
            watchIndex: viewEpisode.watchIndex,
            seasonNumber: viewEpisode.seasonNumber,
            episodeNumber: viewEpisode.episodeNumber,
            watchedAt: viewEpisode.watchedAt,
          })
          .from(viewEpisode)
          .where(eq(viewEpisode.workId, byDouban.id))
          .all();
        for (const episode of episodes) {
          db.insert(viewEpisode)
            .values({ ...episode, workId: existing.id })
            .onConflictDoNothing()
            .run();
        }
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
    // 豆瓣原始别名留档：匹配失败时靠它复现「策略 B 挑了哪个别名」的现场
    aliasesJson: JSON.stringify(item.aliases),
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
