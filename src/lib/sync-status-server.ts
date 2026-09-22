import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { syncRun, taskLock } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { hasTmdbKey } from "@/lib/tmdb";
import {
  AUTO_SYNC_INTERVAL_MS,
  BLOCKED_SYNC_INTERVAL_MS,
  FULL_SYNC_INTERVAL_MS,
  MANUAL_FULL_COOLDOWN_MS,
  MANUAL_INC_COOLDOWN_MS,
  type SyncCardsState,
} from "@/lib/sync-status";
import { deferIntoWindow } from "@/lib/window";

/**
 * 概览页同步卡片状态的**服务端**部分：要读库，因此不能进 lib/sync-status.ts
 * （那份会被客户端组件引用）。冷却常量与 blocker 判定仍在 sync-status.ts，
 * 两边拼起来才是完整的界面依据。
 *
 * 三个计时锚点各有出处，不要混用：
 * - 自动增量（每 2 小时轮）的起点是 sync_run 表里最近一次真正跑完的时间——
 *   调度器每个 tick 也回读它，手动跑完顺带刷新，天然满足「手动后重新计时」。
 * - 自动全量的起点是 setting `douban.lastFullSyncAt`（只有整轮全量真跑完才写）。
 * - 手动全量的冷却同样对着 `douban.lastFullSyncAt` 算，
 *   起点即「任意一次全量（含自动）」，避免连续全量引起风控。
 */

/** 任务锁名与 sync_run 的 kind，取自 doubanSyncJob 的 name / kind，改任务名时要一起改 */
const SYNC_LOCK_NAME = "douban-sync";
const SYNC_KIND = "douban-html";

/** 读一个存 ISO 字符串的时间类配置；没写过或写坏了都当作「没有」 */
function settingTime(
  key: "douban.lastFullSyncAt" | "douban.lastManualIncAt" | "douban.blockedAt",
): number | null {
  const raw = String(getSetting(key) ?? "").trim();
  if (!raw) return null;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : at;
}

/** 最近一次真正跑完的同步结束时间。跑完的定义是 sync_run 落了 finishedAt。 */
function latestFinishedAt(): number | null {
  const row = db
    .select({ finishedAt: syncRun.finishedAt })
    .from(syncRun)
    .where(and(eq(syncRun.kind, SYNC_KIND), isNotNull(syncRun.finishedAt)))
    .orderBy(desc(syncRun.startedAt))
    .limit(1)
    .get();
  return row?.finishedAt ? row.finishedAt.getTime() : null;
}

/**
 * 是否正在同步。锁是落库的，web 与 worker 两个容器都看得见；
 * 只看未过期的锁——进程被 kill 后残留的行不该一直拦着用户。
 */
function isSyncRunning(now: number): boolean {
  const row = db
    .select({ expiresAt: taskLock.expiresAt })
    .from(taskLock)
    .where(eq(taskLock.name, SYNC_LOCK_NAME))
    .get();
  return row !== undefined && row.expiresAt.getTime() > now;
}

export function getSyncCardsState(): SyncCardsState {
  const now = Date.now();
  const lastFinishedAt = latestFinishedAt();
  const lastFullSyncAt = settingTime("douban.lastFullSyncAt");
  const lastManualIncAt = settingTime("douban.lastManualIncAt");
  const blockedAt = settingTime("douban.blockedAt");
  // 退避只看 streak，与 douban-sync 的 intervalMsOf 同一判据：上轮某列表首页
  // 直接被挡时自增，连着一整轮无阻跑完会清零。两边判据一致，倒计时才不会
  // 报出一个调度器根本不打算执行的时刻。
  const blocked = Number(getSetting("douban.blockedStreak") ?? 0) >= 1;
  // 退避期那一轮的间隔由调度器按 6 小时算，倒计时得跟着走，否则会一直显示
  // 「距自动更新 00:xx」而实际要等到 6 小时后。
  const roundIntervalMs = blocked ? BLOCKED_SYNC_INTERVAL_MS : AUTO_SYNC_INTERVAL_MS;

  // 下一轮自动同步在什么时候（见 Scheduler.tick）：每轮跑完起算一个轮次间隔，
  // 到点再看作息窗口；逾期时下一个 tick 立刻补跑。因此不能一律按
  // 「上次结束 + 间隔」算——从没跑过（worker 刚起来）和已逾期这两种情况，
  // 下一轮都是「马上」，而不是一个间隔之后。
  let plannedRoundAt = now;
  if (lastFinishedAt !== null) {
    const due = lastFinishedAt + roundIntervalMs;
    plannedRoundAt = due > now ? due : now;
  }
  // 到点时若在窗口外，调度器会把它顺延到下一个释放点。真正开跑的是顺延后的
  // 时刻，后面所有推算都得从它起算，否则会把「开窗前」的那段空等漏掉。
  const nextRoundAt = deferIntoWindow(plannedRoundAt);

  /** 第 n 个轮次刻度（n 从 1 起）。每轮到点都会被顺延一次窗口，这里照做。 */
  const tickAt = (n: number) =>
    deferIntoWindow(nextRoundAt + n * roundIntervalMs);

  // 这一轮抓全量还是增量，取决于「跑它的那一刻距上次全量是否满一周」，
  // 与 runDoubanSync 里的 isFullSyncDue() 是同一个判定。
  const roundIsFull =
    lastFullSyncAt === null ||
    nextRoundAt - lastFullSyncAt >= FULL_SYNC_INTERVAL_MS;

  // 这一轮不是全量时，往后数到第一个「满一周」的刻度，就是下次全量。
  // 刻度是轮次间隔的整数倍，所以真正跑全量的是「满 7 天之后的第一个刻度」，
  // 而不是满 7 天那一刻——直接取满 7 天会早报几小时、倒计时归零后干等。
  const ticksToFull = Math.max(
    1,
    Math.ceil(
      ((lastFullSyncAt ?? 0) + FULL_SYNC_INTERVAL_MS - nextRoundAt) /
        roundIntervalMs,
    ),
  );

  // 本轮是全量时，增量要往后让一个刻度——否则两张卡指向同一时刻，
  // 既看不出差别，也把「下一轮其实是全量」这件事说错了。
  const nextFullAuto = roundIsFull ? nextRoundAt : tickAt(ticksToFull);
  const nextIncrementalAuto = roundIsFull ? tickAt(1) : nextRoundAt;

  return {
    now,
    running: isSyncRunning(now),
    configured:
      String(getSetting("douban.uid") ?? "").trim() !== "" && hasTmdbKey(),
    nextIncrementalAutoAt: nextIncrementalAuto,
    nextFullAutoAt: nextFullAuto,
    manualFullReadyAt: (lastFullSyncAt ?? 0) + MANUAL_FULL_COOLDOWN_MS,
    manualIncrementalReadyAt: (lastManualIncAt ?? 0) + MANUAL_INC_COOLDOWN_MS,
    blocked,
    blockedAt: blocked ? (blockedAt ?? 0) : 0,
  };
}
