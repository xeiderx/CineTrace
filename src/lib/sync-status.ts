/**
 * 手动同步的冷却规则与卡片状态类型。纯计算、不碰数据库——
 * 服务端算状态、客户端判按钮可用性都用这一份，两边口径必须完全一致，
 * 否则会出现「按钮亮着但服务端拒绝」这种自相矛盾的界面。
 */

/** 两次手动全量之间的最小间隔 */
export const MANUAL_FULL_COOLDOWN_MS = 72 * 60 * 60 * 1000;
/** 两次手动增量之间的最小间隔 */
export const MANUAL_INC_COOLDOWN_MS = 60 * 60 * 1000;
/** 手动增量卡片的说明文案里用到的时长，与上面的常量同源 */
export const MANUAL_INC_COOLDOWN_HINT = "1 小时";
/** 两次全量回扫的最小间隔，与 douban-sync 内的 FULL_SYNC_INTERVAL_MS 一致 */
export const FULL_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** 自动轮的间隔，与 douban-sync 任务的 intervalMs 一致 */
export const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type SyncMode = "full" | "incremental";

export type SyncCardsState = {
  /** 服务端渲染时刻（毫秒）。客户端据此换算时钟偏差，倒计时不受两端时间差影响 */
  now: number;
  /** 是否已有一轮同步在跑（worker 定时任务或另一个标签页手动触发） */
  running: boolean;
  /** 豆瓣 ID 与 TMDB Key 是否都已配好 */
  configured: boolean;
  /** 下一次自动增量预计放行的时刻 */
  nextIncrementalAutoAt: number;
  /** 下一次自动全量预计放行的时刻 */
  nextFullAutoAt: number;
  /** 手动全量可再次使用的时刻 */
  manualFullReadyAt: number;
  /** 手动增量可再次使用的时刻 */
  manualIncrementalReadyAt: number;
};

/**
 * 该模式此刻能不能手动触发；不能则给出原因，能则返回 null。
 * 服务端与客户端共用，保证按钮的可用状态与 action 的校验口径完全一致。
 */
export function manualSyncBlocker(
  state: Pick<
    SyncCardsState,
    "running" | "configured" | "manualFullReadyAt" | "manualIncrementalReadyAt"
  >,
  mode: SyncMode,
  now: number,
): string | null {
  if (!state.configured) return "请先在设置里填好豆瓣 ID 与 TMDB API Key";
  if (state.running) return "正在同步中，等这一轮跑完再试";
  const readyAt =
    mode === "full" ? state.manualFullReadyAt : state.manualIncrementalReadyAt;
  if (now >= readyAt) return null;
  return mode === "full"
    ? "距上次全量不足 72 小时"
    : `距上次手动增量不足 ${MANUAL_INC_COOLDOWN_HINT}`;
}
