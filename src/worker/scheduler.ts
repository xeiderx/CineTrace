import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { syncRun } from "@/db/schema";
import { isWithinWindow } from "./throttle";
import { runJob, type Job } from "./job";

/** 调度器轮询间隔：每次 tick 只做轻量的时间比较，不做网络请求 */
const TICK_MS = 30_000;

type ScheduledJob = Job & {
  /** 受作息窗口与总开关约束的任务（即所有对外抓取任务） */
  windowed?: boolean;
  /**
   * 上次执行结束的时间戳。启动时从 sync_run 表读回，之后仅进程内更新——
   * 否则每次进程重启都会立刻重跑一轮，开发期频繁重建就等于持续抓取。
   */
  lastFinishedAt?: number;
};

/**
 * 极简调度器：单进程内按固定间隔轮询，到点的任务交给 runJob 抢锁执行。
 * 之所以不做 cron 表达式与持久化队列——单用户量级下，
 * 任务错过一次下次 tick 补上即可，复杂调度只会增加排查成本。
 */
export class Scheduler {
  private jobs: ScheduledJob[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  add(job: ScheduledJob): this {
    this.jobs.push(job);
    return this;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // 先从数据库读回各任务的计时起点，再跑第一轮
    void this.seed().then(() => this.tick());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 用 sync_run 表里的最近一次结束时间恢复计时。
   * 按 kind 而非 name 查：同一种同步可能被多个任务名触发（如手动同步）。
   * 表里没有记录时保持 undefined，即首次部署仍会立刻跑一轮。
   */
  private async seed(): Promise<void> {
    for (const job of this.jobs) {
      try {
        const row = db
          .select({ finishedAt: syncRun.finishedAt })
          .from(syncRun)
          .where(and(eq(syncRun.kind, job.kind), isNotNull(syncRun.finishedAt)))
          .orderBy(desc(syncRun.startedAt))
          .limit(1)
          .get();
        if (row?.finishedAt) {
          job.lastFinishedAt = row.finishedAt.getTime();
        }
      } catch (error) {
        // 读不到就当作没跑过，退回旧行为，不阻塞调度器启动
        console.error(`[scheduler] 恢复 ${job.name} 计时失败`, error);
      }
    }
  }

  private async tick(): Promise<void> {
    // 上一轮还没跑完就跳过本次，避免任务堆叠
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      for (const job of this.jobs) {
        if (job.lastFinishedAt && now - job.lastFinishedAt < job.intervalMs) {
          continue;
        }
        if (job.windowed && !isWithinWindow()) {
          continue;
        }
        // 抢不到锁（上一轮还在跑，或进程被 kill 后锁未到期）意味着任务并没执行，
        // 不能记成「刚跑完」——否则会白白空等一个 interval 才重试
        if (await runJob(job)) {
          job.lastFinishedAt = Date.now();
        }
      }
    } finally {
      this.running = false;
    }
  }
}
