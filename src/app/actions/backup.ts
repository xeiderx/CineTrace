"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { work } from "@/db/schema";
import {
  countPendingMetadata,
  importBackup,
  listPendingMetadata,
  parseBackupFile,
} from "@/lib/backup";
import { hasTmdbKey, tmdbDetail } from "@/lib/tmdb";
import { sleep } from "@/worker/throttle";

export type BackupFormState =
  | { error?: string; ok?: boolean; message?: string }
  | undefined;

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

/** 导入备份文件。合并语义：已存在的按唯一键更新，不删除任何现有数据。 */
export async function importBackupAction(
  _prev: BackupFormState,
  formData: FormData,
): Promise<BackupFormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "请选择要导入的备份文件" };
  }
  if (file.size > MAX_BACKUP_BYTES) {
    return { error: "备份文件过大，请确认选择了正确的文件" };
  }

  try {
    const parsed = parseBackupFile(await file.text());
    const stats = importBackup(parsed);

    // 导入会改动几乎所有页面，整棵路由树失效最省心
    revalidatePath("/", "layout");

    const pending = countPendingMetadata();
    const summary = [
      `作品 ${stats.works}`,
      `观影记录 ${stats.viewRecords}`,
      `平台 ${stats.platforms}`,
      `标签 ${stats.tags}`,
      `片单 ${stats.collections}`,
      `设置 ${stats.settings}`,
    ].join(" · ");

    return {
      ok: true,
      message: pending > 0
        ? `已合并导入：${summary}。另有 ${pending} 部作品缺少 TMDB 元数据，可点下方按钮补全。`
        : `已合并导入：${summary}。`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/* -------------------------------------------------------------------------- */
/*                            手动补全 TMDB 元数据                             */
/* -------------------------------------------------------------------------- */

/** 手动回填的批次大小：一批做完就返回，避免单次请求拖太久。 */
const BACKFILL_BATCH = 50;
/**
 * 回填请求间隔。手动触发不走作息窗口、也不用同步任务那套 3~8 秒延迟——
 * TMDB 的限流远没有豆瓣严格，250ms 足够安全。
 */
const BACKFILL_GAP_MS = 250;

/**
 * 为「有 tmdbId 但从未同步过详情」的作品拉 TMDB 详情。
 * 导入备份后走这条路补齐海报、简介、时长与分季结构。
 * 每批处理 BACKFILL_BATCH 条就返回，剩余的可再次点击继续。
 */
export async function backfillMetadataAction(): Promise<BackupFormState> {
  if (!hasTmdbKey()) {
    return { error: "请先在「豆瓣同步」里填写 TMDB API Key" };
  }

  const pending = listPendingMetadata(BACKFILL_BATCH);
  if (pending.length === 0) {
    return { ok: true, message: "所有作品都已具备元数据，无需补全。" };
  }

  let updated = 0;
  let failed = 0;

  for (const row of pending) {
    const detail = await tmdbDetail(row.mediaType === "tv" ? "tv" : "movie", row.tmdbId);
    if (!detail) {
      failed += 1;
      await sleep(BACKFILL_GAP_MS);
      continue;
    }

    const isTv = row.mediaType === "tv";
    const firstSeasonYear = detail.seasons[0]?.airDate
      ? Number(detail.seasons[0].airDate.slice(0, 4)) || null
      : null;

    db.update(work)
      .set({
        posterPath: detail.posterPath,
        runtime: detail.runtime,
        seasonCount: isTv ? detail.seasonCount ?? (detail.seasons.length || null) : null,
        episodeCount: isTv ? detail.episodeCount ?? null : null,
        seasonsJson: JSON.stringify(isTv ? detail.seasons : []),
        releaseDate: detail.releaseDate,
        imdbId: detail.imdbId,
        genres: JSON.stringify(detail.genres),
        directors: JSON.stringify(detail.directors),
        // 剧集年份取第一季首播年，与同步任务保持一致
        ...(isTv && firstSeasonYear != null ? { year: firstSeasonYear } : {}),
        metadataSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(work.id, row.id))
      .run();

    updated += 1;
    await sleep(BACKFILL_GAP_MS);
  }

  const remaining = countPendingMetadata();
  revalidatePath("/", "layout");

  return {
    ok: true,
    message: remaining > 0
      ? `本次补全 ${updated} 部（失败 ${failed} 部），还剩 ${remaining} 部，可再次点击继续。`
      : `补全完成：本次 ${updated} 部（失败 ${failed} 部）。`,
  };
}
