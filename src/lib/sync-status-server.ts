import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { syncRun, taskLock } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { hasTmdbKey } from "@/lib/tmdb";
import {
  AUTO_SYNC_INTERVAL_MS,
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
 * - 自动增量（每 6 小时轮）的起点是 sync_run 表里最近一次真正跑完的时间——
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
  key: "douban.lastFullSyncAt" | "douban.lastManualIncAt",
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

  // 自动轮的放行条件（见 Scheduler.tick）：先满足 6 小时的 interval，
  // 再落进作息窗口。已经逾期（例如 worker 停过一段）时用 now 兜底，
  // 显示为「即将执行」而不是负数。
  const base = lastFinishedAt ?? now;

  // 全量发生在哪一轮：调度时刻是「上次结束 + 6h」的整数倍，
  // 所以真正跑全量的是「满 7 天之后的第一个 6 小时刻度」，而不是满 7 天那一刻。
  // 直接取满 7 天的时刻会早报几小时、倒计时归零后干等，这里向上取整到刻度上。
  //
  // 从没全量过时不能拿 0 当起点——那会算出 1970 年的「已逾期」，
  // 兜底成第 1 个刻度，跟增量撞在同一个时刻上。此处直接认定下一轮就是全量，
  // 与 isFullSyncDue() 在 lastFullSyncAt 为空时返回 true 的判定保持一致。
  const fullTicks =
    lastFullSyncAt === null
      ? 1
      : Math.max(
          1,
          Math.ceil(
            (lastFullSyncAt + FULL_SYNC_INTERVAL_MS - base) /
              AUTO_SYNC_INTERVAL_MS,
          ),
        );
  const fullDueAt = base + fullTicks * AUTO_SYNC_INTERVAL_MS;

  // 增量跑在「不做全量的那些轮」里。第 1 个刻度被全量占用时，增量要再等
  // 一个刻度——否则两张卡指向同一时刻，既看不出差别，
  // 也把「下一轮其实是全量」这件事说错了。
  const incrementalDueAt =
    base + (fullTicks === 1 ? 2 : 1) * AUTO_SYNC_INTERVAL_MS;

  return {
    now,
    running: isSyncRunning(now),
    configured:
      String(getSetting("douban.uid") ?? "").trim() !== "" && hasTmdbKey(),
    nextIncrementalAutoAt: deferIntoWindow(Math.max(now, incrementalDueAt)),
    nextFullAutoAt: deferIntoWindow(Math.max(now, fullDueAt)),
    manualFullReadyAt: (lastFullSyncAt ?? 0) + MANUAL_FULL_COOLDOWN_MS,
    manualIncrementalReadyAt: (lastManualIncAt ?? 0) + MANUAL_INC_COOLDOWN_MS,
  };
}
