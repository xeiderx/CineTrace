"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
  | {
      error?: string;
      ok?: boolean;
      message?: string;
    }
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
      `逐集进度 ${stats.viewEpisodes}`,
      `平台 ${stats.platforms}`,
      `来源渠道 ${stats.sourceChannels}`,
      `图标库 ${stats.iconLibraries}`,
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

/** 手动回填的批次大小：几批之间留出观察进度的机会，也避免单次占住太久。 */
const BACKFILL_BATCH = 50;
/**
 * 回填请求间隔。手动触发不走作息窗口、也不用同步任务那套 3~8 秒延迟——
 * TMDB 的限流远没有豆瓣严格，250ms 足够安全。
 */
const BACKFILL_GAP_MS = 250;
/** 兜底上限，正常路径靠「一整批都没成功」退出，这里只防意外 */
const BACKFILL_MAX_ROUNDS = 100;

export type BackfillState = {
  error?: string;
  /** 后台是否仍在补全 */
  running: boolean;
  /** 本次补全启动时的待补总数 */
  total: number;
  /** 本次已补上主演信息、不再待补的数量 */
  done: number;
  /** 当前仍待补的数量（实时统计，含拉取失败的） */
  pending: number;
  message?: string;
};

type BackfillProgress = { running: boolean; total: number; done: number };

/**
 * 补全进度只放 web 进程内存里。
 * 补全由 after() 在本进程继续跑，前端轮询同一进程即可看到结果；
 * 单容器部署下没必要落库。（进程重启会丢进度，但已写入的数据不受影响。）
 */
let backfill: BackfillProgress | null = null;

function backfillSnapshot(): BackfillState {
  const pending = countPendingMetadata();
  if (!backfill) {
    return { running: false, total: 0, done: 0, pending };
  }
  return {
    running: backfill.running,
    total: backfill.total,
    done: backfill.done,
    pending,
    message: backfill.running
      ? undefined
      : backfill.done === 0
        ? "剩下的作品 TMDB 上都没有演员数据，补不了；海报、简介等已是最新。"
        : pending === 0
          ? `补全完成：本次补全 ${backfill.done} 部。`
          : `本次补全 ${backfill.done} 部。还有 ${pending} 部在 TMDB 上没有演员数据，拉不到，可到档案库按「待补全」查看。`,
  };
}

/**
 * 启动元数据补全，为「有 tmdbId 但从未同步过详情」的作品拉取
 * 海报、简介、时长与分季结构。
 *
 * 立即返回，真正的抓取交给 after() 在响应结束后继续跑——
 * 这样补全期间页面导航不会被 server action 挂住。
 * 重复点击只会返回当前进度，不会起第二个任务。
 */
export async function backfillMetadataAction(): Promise<BackfillState> {
  if (!hasTmdbKey()) {
    return {
      error: "请先在「豆瓣同步」里填写 TMDB API Key",
      running: false,
      total: 0,
      done: 0,
      pending: countPendingMetadata(),
    };
  }

  if (backfill?.running) return backfillSnapshot();

  const total = countPendingMetadata();
  if (total === 0) {
    return {
      running: false,
      total: 0,
      done: 0,
      pending: 0,
      message: "所有作品都已具备元数据，无需补全。",
    };
  }

  const progress: BackfillProgress = { running: true, total, done: 0 };
  backfill = progress;
  after(() => runBackfill(progress));

  return backfillSnapshot();
}

/** 前端轮询补全进度。 */
export async function getBackfillProgressAction(): Promise<BackfillState> {
  return backfillSnapshot();
}

/**
 * 一批接一批补到没有进展为止，全程只更新内存里的进度对象。
 *
 * 进展的判据是「待补数量有没有下降」，不是「TMDB 请求有没有成功」——
 * 有些条目（尤其纪录片、冷门片）TMDB 上就是没有演员数据，`cast` 会一直是空，
 * 于是它们每次都会被重新取到、每次「请求成功」，待补数量却一动不动。
 * 只看请求成功与否会让循环空转到轮次上限，进度条还会涨到超过总数。
 */
async function runBackfill(progress: BackfillProgress): Promise<void> {
  try {
    let lastPending = countPendingMetadata();

    for (let round = 0; round < BACKFILL_MAX_ROUNDS; round += 1) {
      const batch = listPendingMetadata(BACKFILL_BATCH);
      if (batch.length === 0) break;

      for (const row of batch) {
        if (await fillOne(row)) progress.done += 1;
        await sleep(BACKFILL_GAP_MS);
      }

      const pending = countPendingMetadata();
      // 一轮下来待补数量没减少，说明剩下的都是 TMDB 侧拉不到数据的，再跑也是白跑
      if (pending >= lastPending) break;
      lastPending = pending;
    }
  } catch (error) {
    console.error("[backfill] 补全中断", error);
  } finally {
    progress.running = false;
  }
}

/**
 * 拉取并写入单部作品的 TMDB 元数据。
 *
 * 返回值表示「这部作品是否已经不再待补」，而不是「请求是否成功」——
 * 待补的判据是有 tmdbId 且主演为空，而有些作品 TMDB 上就是没有演员数据，
 * 写完之后依旧待补。把它们算作成功会让进度条超出总数、也掩盖真实进展。
 */
async function fillOne(row: {
  id: number;
  mediaType: string;
  tmdbId: number;
}): Promise<boolean> {
  const detail = await tmdbDetail(row.mediaType === "tv" ? "tv" : "movie", row.tmdbId);
  if (!detail) return false;

  const isTv = row.mediaType === "tv";
  const firstSeasonYear = detail.seasons[0]?.airDate
    ? Number(detail.seasons[0].airDate.slice(0, 4)) || null
    : null;

  db.update(work)
    .set({
      posterPath: detail.posterPath,
      overview: detail.overview,
      runtime: detail.runtime,
      seasonCount: isTv ? detail.seasonCount ?? (detail.seasons.length || null) : null,
      episodeCount: isTv ? detail.episodeCount ?? null : null,
      seasonsJson: JSON.stringify(isTv ? detail.seasons : []),
      releaseDate: detail.releaseDate,
      imdbId: detail.imdbId,
      genres: JSON.stringify(detail.genres),
      countries: JSON.stringify(detail.countries),
      directors: JSON.stringify(detail.directors),
      cast: JSON.stringify(detail.cast),
      // 剧集年份取第一季首播年，与同步任务保持一致
      ...(isTv && firstSeasonYear != null ? { year: firstSeasonYear } : {}),
      metadataSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(work.id, row.id))
    .run();

  // 写入后是否还留在待补队列里，取决于主演与简介有没有都拿到（见 lib/backup.ts 的判定）
  return detail.cast.length > 0 && Boolean(detail.overview);
}
