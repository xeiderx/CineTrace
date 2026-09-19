"use server";

import { revalidatePath } from "next/cache";
import { setSetting } from "@/lib/settings";

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

const MIN_DELAY_FLOOR_MS = 500;
const MAX_DELAY_CEIL_MS = 120_000;

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

  const minDelayMs = int(formData, "sync.minDelayMs");
  const maxDelayMs = int(formData, "sync.maxDelayMs");
  if (minDelayMs == null || maxDelayMs == null) {
    return { error: "请求延迟请填整数毫秒" };
  }
  if (minDelayMs < MIN_DELAY_FLOOR_MS) {
    return { error: `最小延迟不应低于 ${MIN_DELAY_FLOOR_MS} 毫秒，太快容易触发风控` };
  }
  if (maxDelayMs < minDelayMs) {
    return { error: "最大延迟不能小于最小延迟" };
  }
  if (maxDelayMs > MAX_DELAY_CEIL_MS) {
    return { error: `最大延迟不应超过 ${MAX_DELAY_CEIL_MS} 毫秒` };
  }

  // Switch 旁显式放的 hidden input，值为 "true" / "false"
  const enabled = formData.get("sync.enabled") === "true";
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
  setSetting("sync.windowStart", windowStart);
  setSetting("sync.windowEnd", windowEnd);
  setSetting("sync.minDelayMs", minDelayMs);
  setSetting("sync.maxDelayMs", maxDelayMs);
  setSetting("tmdb.apiKey", tmdbApiKey);

  revalidatePath("/settings");
  return { ok: true };
}
