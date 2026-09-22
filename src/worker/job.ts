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
  /**
   * 运行时决定基础间隔（毫秒），缺省用 intervalMs。给需要按当下状态
   * 调整频率的任务用，目前只有豆瓣同步：撞上风控时临时退回长间隔。
   * 只由调度器消费，runJob 不关心。
   */
  intervalMsOf?: () => number;
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
  /**
   * 任务压根没开始干活时置 true（总开关关闭、缺必填配置等）。
   * 这类「跳过」不应计入调度间隔——否则一次没配好的空转
   * 会白白占用一个完整轮询周期，用户补好配置后要等很久才会真正跑。
   */
  skipped?: boolean;
};

/** 一次调度的结果。ran=false 表示没抢到锁（别的进程正在跑），任务并未执行。 */
export type JobRunOutcome = {
  ran: boolean;
  /** 执行了但没真正抓取，仅缺配置一类的空转 */
  skipped: boolean;
  result: JobResult | null;
};

/** 执行一次任务：落库 sync_run 记录，并全程持锁。 */
export async function runJob(job: Job): Promise<JobRunOutcome> {
  // 抢不到锁与任务抛异常都会让 withLock 返回 null，靠这个标记区分：
  // 只有真进了回调才算「执行过」
  let executed = false;
  let skipped = false;

  const result = await withLock(
    job.name,
    job.lockTtlMs,
    async (): Promise<JobResult | null> => {
      executed = true;
      const started = new Date();
      const runRow = db
        .insert(syncRun)
        .values({ kind: job.kind, status: "running", startedAt: started })
        .returning({ id: syncRun.id })
        .get();

      try {
        const outcome = await job.run();
        if (outcome.skipped) {
          // 没真正抓取，连带这条 running 记录一起撤掉：总开关长期关闭时
          // 若照记不误，这张表会被纯粹的「空转」记录灌满
          db.delete(syncRun).where(eq(syncRun.id, runRow.id)).run();
          skipped = true;
          log(job.name, "跳过", outcome);
          return outcome;
        }
        db.update(syncRun)
          .set({
            status: outcome.partial ? "partial" : "success",
            finishedAt: new Date(),
            cursor: outcome.cursor ?? null,
            itemsSeen: outcome.itemsSeen ?? 0,
            itemsNew: outcome.itemsNew ?? 0,
            itemsUpdated: outcome.itemsUpdated ?? 0,
            errorCount: outcome.errorCount ?? 0,
            message: outcome.message ?? null,
          })
          .where(eq(syncRun.id, runRow.id))
          .run();
        log(job.name, "完成", outcome);
        return outcome;
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
        return null;
      }
    },
  );

  return { ran: executed, skipped, result };
}

function log(name: string, status: string, detail: unknown) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] [${name}] ${status}`, JSON.stringify(detail));
}
