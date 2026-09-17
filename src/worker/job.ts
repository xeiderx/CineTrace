import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncRun } from "@/db/schema";
import { withLock } from "./lock";

/**
 * 一个同步任务。
 * 任务是「幂等 + 可重入」的：中断后重跑不应产生重复数据，
 * 幂等靠 view_record.sourceKey / raw_archive.urlHash 的唯一索引兜底。
 */
export type Job = {
  /** 唯一名，同时也是锁名 */
  name: string;
  /** 'douban-html' | 'douban-rss' | 'tmdb-metadata' | 'backfill' */
  kind: string;
  /** 期望的执行间隔（毫秒）。到点且未被锁定才执行 */
  intervalMs: number;
  /** 锁的存活时间，应大于任务最长可能耗时，防止提前过期被抢 */
  lockTtlMs: number;
  run: () => Promise<JobResult>;
};

export type JobResult = {
  itemsSeen?: number;
  itemsNew?: number;
  itemsUpdated?: number;
  errorCount?: number;
  cursor?: string | null;
  message?: string;
  /** 任务内部认为本次是「部分成功」时置 true */
  partial?: boolean;
};

/** 执行一次任务：落库 sync_run 记录，并全程持锁。 */
export async function runJob(job: Job): Promise<boolean> {
  return (
    (await withLock(job.name, job.lockTtlMs, async () => {
      const started = new Date();
      const runRow = db
        .insert(syncRun)
        .values({ kind: job.kind, status: "running", startedAt: started })
        .returning({ id: syncRun.id })
        .get();

      try {
        const result = await job.run();
        db.update(syncRun)
          .set({
            status: result.partial ? "partial" : "success",
            finishedAt: new Date(),
            cursor: result.cursor ?? null,
            itemsSeen: result.itemsSeen ?? 0,
            itemsNew: result.itemsNew ?? 0,
            itemsUpdated: result.itemsUpdated ?? 0,
            errorCount: result.errorCount ?? 0,
            message: result.message ?? null,
          })
          .where(eq(syncRun.id, runRow.id))
          .run();
        log(job.name, `完成`, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        db.update(syncRun)
          .set({
            status: "failed",
            finishedAt: new Date(),
            errorCount: 1,
            message,
          })
          .where(eq(syncRun.id, runRow.id))
          .run();
        // 单个任务失败不应拖垮整个调度循环
        log(job.name, "失败", { message });
      }
    })) !== null
  );
}

function log(name: string, status: string, detail: unknown) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] [${name}] ${status}`, JSON.stringify(detail));
}
