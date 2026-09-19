"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { setSetting } from "@/lib/settings";
import {
  manualSyncBlocker,
  type SyncCardsState,
  type SyncMode,
} from "@/lib/sync-status";
import { getSyncCardsState } from "@/lib/sync-status-server";
import { runManualDoubanSync } from "@/worker/jobs/douban-sync";

export type FormState = { error?: string; ok?: boolean } | undefined;

/* -------------------------------------------------------------------------- */
/*                                    工具                                      */
/* -------------------------------------------------------------------------- */

/** 空字符串归一为 null，便于区分「没填」与「填了空」 */
function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 解析整数，非法或空返回 null */
function int(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** "HH:MM" 24 小时制 */
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 豆瓣 ID 可能是数字 ID，也可能是自定义字母 ID */
const UID_RE = /^[A-Za-z0-9._-]+$/;
/** TMDB v3 Key 是 32 位十六进制串，这里只做「不含空白/特殊字符」的粗校验 */
const TMDB_KEY_RE = /^[A-Za-z0-9._-]+$/;

const MIN_DELAY_FLOOR_SEC = 1;
const MAX_DELAY_CEIL_SEC = 120;
const MAX_JITTER_CEIL_MIN = 180;

/* -------------------------------------------------------------------------- */
/*                                  同步设置                                    */
/* -------------------------------------------------------------------------- */

/**
 * 保存豆瓣同步配置。作息窗口与延迟区间直接决定抓取节奏，
 * 因此在这里做边界校验，避免把明显危险的配置写进库。
 */
export async function saveSyncSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const uid = text(formData, "douban.uid") ?? "";
  if (uid && !UID_RE.test(uid)) {
    return { error: "豆瓣 ID 只能包含字母、数字、下划线、点或连字符" };
  }

  const windowStart = text(formData, "sync.windowStart") ?? "";
  const windowEnd = text(formData, "sync.windowEnd") ?? "";
  if (!CLOCK_RE.test(windowStart) || !CLOCK_RE.test(windowEnd)) {
    return { error: "作息窗口请填 24 小时制的 HH:MM，例如 09:00" };
  }

  const jitterMin = int(formData, "sync.windowJitterMin");
  const jitterMax = int(formData, "sync.windowJitterMax");
  if (jitterMin == null || jitterMax == null) {
    return { error: "窗口随机延迟请填整数分钟" };
  }
  if (jitterMin < 0) {
    return { error: "窗口随机延迟不能为负数" };
  }
  if (jitterMax < jitterMin) {
    return { error: "窗口随机延迟上限不能小于下限" };
  }
  if (jitterMax > MAX_JITTER_CEIL_MIN) {
    return { error: `窗口随机延迟上限不应超过 ${MAX_JITTER_CEIL_MIN} 分钟` };
  }

  const minDelaySec = int(formData, "sync.minDelaySec");
  const maxDelaySec = int(formData, "sync.maxDelaySec");
  if (minDelaySec == null || maxDelaySec == null) {
    return { error: "请求延迟请填整数秒" };
  }
  if (minDelaySec < MIN_DELAY_FLOOR_SEC) {
    return { error: `最小延迟不应低于 ${MIN_DELAY_FLOOR_SEC} 秒，太快容易触发风控` };
  }
  if (maxDelaySec < minDelaySec) {
    return { error: "最大延迟不能小于最小延迟" };
  }
  if (maxDelaySec > MAX_DELAY_CEIL_SEC) {
    return { error: `最大延迟不应超过 ${MAX_DELAY_CEIL_SEC} 秒` };
  }

  // Switch 旁显式放的 hidden input，值为 "true" / "false"
  const enabled = formData.get("sync.enabled") === "true";
  const syncWatching = formData.get("douban.syncWatching") === "true";
  const syncWish = formData.get("douban.syncWish") === "true";
  if (enabled && !uid) {
    return { error: "启用同步前请先填写豆瓣 ID" };
  }

  // 留空表示清掉库里的值，回落到环境变量 TMDB_API_KEY
  const tmdbApiKey = text(formData, "tmdb.apiKey") ?? "";
  if (tmdbApiKey && !TMDB_KEY_RE.test(tmdbApiKey)) {
    return { error: "TMDB API Key 只能包含字母、数字、点、下划线或连字符" };
  }

  setSetting("douban.uid", uid);
  setSetting("sync.enabled", enabled);
  setSetting("douban.syncWatching", syncWatching);
  setSetting("douban.syncWish", syncWish);
  setSetting("sync.windowStart", windowStart);
  setSetting("sync.windowEnd", windowEnd);
  setSetting("sync.windowJitterMin", jitterMin);
  setSetting("sync.windowJitterMax", jitterMax);
  setSetting("sync.minDelaySec", minDelaySec);
  setSetting("sync.maxDelaySec", maxDelaySec);
  setSetting("tmdb.apiKey", tmdbApiKey);

  revalidatePath("/settings");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*                                  立即同步                                    */
/* -------------------------------------------------------------------------- */

export type ManualSyncState = {
  error?: string;
  /** 是否仍在抓取 */
  running: boolean;
  /** 已处理条目数 */
  seen: number;
  /** 豆瓣声明的总数，未解析到或尚未开始时为 null */
  total: number | null;
  message?: string;
};

type ManualSyncProgress = {
  running: boolean;
  seen: number;
  total: number | null;
  message?: string;
};

/**
 * 手动同步进度同样只放 web 进程内存：任务由 after() 在本进程继续跑，
 * 前端轮询同一进程即可。（与补全进度同理，重启只丢进度显示。）
 * 两张卡片共用一个槽位——同一时刻只可能有一轮手动同步在跑。
 */
let manualSync: ManualSyncProgress | null = null;

function manualSyncSnapshot(): ManualSyncState {
  if (!manualSync) {
    return { running: false, seen: 0, total: null };
  }
  return {
    running: manualSync.running,
    seen: manualSync.seen,
    total: manualSync.total,
    message: manualSync.message,
  };
}

/**
 * 概览页同步卡片的状态：倒计时的全部依据由服务端算好，
 * 客户端只负责按秒重绘。页面加载与每次手动触发后各取一次。
 */
export async function getSyncCardsStateAction(): Promise<SyncCardsState> {
  return getSyncCardsState();
}

/**
 * 立即抓取一轮豆瓣。绕过 sync.enabled 总开关——用户手动点按钮就是明确的意图。
 * 与 worker 的定时任务共用同一把锁，撞上时直接告知而不是排队等待。
 * 抓取耗时视规模而定：首次全量回扫两千多条要数小时（逐条等 TMDB），
 * 之后元数据已齐就只剩翻页间隔，几十分钟即可跑完。
 * 因此和补全一样交给 after() 在响应结束后跑，期间页面导航不会被挂住。
 * 锁的存活由续租维持，不会因为跑得久而被 worker 抢走。
 *
 * 冷却在服务端校验而非只靠前端禁用：倒计时是前端算的，刷新页面、
 * 改系统时间都能绕过，真正的闸门必须在发请求的这一侧。
 */
export async function startManualSyncAction(mode: SyncMode): Promise<ManualSyncState> {
  if (manualSync?.running) return manualSyncSnapshot();

  const state = getSyncCardsState();
  const blocker = manualSyncBlocker(state, mode, state.now);
  if (blocker) {
    return { error: blocker, running: false, seen: 0, total: null };
  }

  const progress: ManualSyncProgress = { running: true, seen: 0, total: null };
  manualSync = progress;
  after(() => runManualSync(progress, mode));

  return manualSyncSnapshot();
}

/** 前端轮询手动同步进度。 */
export async function getManualSyncProgressAction(): Promise<ManualSyncState> {
  return manualSyncSnapshot();
}

async function runManualSync(progress: ManualSyncProgress, mode: SyncMode): Promise<void> {
  try {
    const { ran, result } = await runManualDoubanSync((p) => {
      progress.seen = p.seen;
      progress.total = p.total;
    }, mode);

    if (!ran) {
      progress.message = "worker 正在同步，等它跑完再试。";
      return;
    }
    progress.message = result?.message ?? "同步结束。";
    // 抓取会改动作品与观影记录，整棵路由树失效最省心
    revalidatePath("/", "layout");
  } catch (error) {
    progress.message = `同步中断：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    progress.running = false;
  }
}
