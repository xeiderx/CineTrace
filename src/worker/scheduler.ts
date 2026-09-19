import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { syncRun } from "@/db/schema";
import { isWithinWindow, nextWindowReleaseAt } from "./throttle";
import { runJob, type Job } from "./job";

/** 调度器轮询间隔：每次 tick 只做轻量的时间比较，不做网络请求 */
const TICK_MS = 30_000;

/**
 * 跳过一轮后多久再试。跳过的原因是「没配好」（开关关着、缺 UID / Key），
 * 这类状态不会自己变，没必要每个 tick 都去试一遍——否则同步长期关闭时，
 * 每 30 秒就会有一轮「插记录再删掉」的空转。用户改完设置后最多等这么久即生效。
 */
const SKIP_RETRY_MS = 5 * 60_000;

type ScheduledJob = Job & {
  /** 受作息窗口与总开关约束的任务（即所有对外抓取任务） */
  windowed?: boolean;
  /**
   * 上次执行结束的时间戳。启动时从 sync_run 表读回，之后每轮 tick
   * 都会再回读一次表里的最新值（手动同步跑在 web 进程，只有落库后
   * worker 才看得见），因此这里是「内存缓存」而非唯一真相。
   */
  lastFinishedAt?: number;
  /**
   * 下一次可以尝试的时间点，提前于它一律不试。两种来源：
   * - 跳过后的冷却：跳过的原因是「没配好」（开关关着、缺 UID / Key），
   *   这类状态不会自己变，没必要每个 tick 都去试一遍——否则同步长期关闭时，
   *   每 30 秒就会有一轮「插记录再删掉」的空转。用户改完设置后最多等这么久即生效。
   * - 窗口外的释放点：见 tick 里对 isWithinWindow 的说明。
   */
  nextAttemptAt?: number;
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
   * 读某个 kind 最近一次真正结束的时间。
   * 按 kind 而非 name 查：同一种同步可能被多个任务名触发（如手动同步）。
   * 表里没有记录（或只有未结束的行）时返回 null。
   */
  private latestFinishedAt(kind: string): number | null {
    const row = db
      .select({ finishedAt: syncRun.finishedAt })
      .from(syncRun)
      .where(and(eq(syncRun.kind, kind), isNotNull(syncRun.finishedAt)))
      .orderBy(desc(syncRun.startedAt))
      .limit(1)
      .get();
    return row?.finishedAt ? row.finishedAt.getTime() : null;
  }

  /**
   * 用 sync_run 表里的最近一次结束时间恢复计时。
   * 表里没有记录时保持 undefined，即首次部署仍会立刻跑一轮。
   */
  private async seed(): Promise<void> {
    for (const job of this.jobs) {
      try {
        const finishedAt = this.latestFinishedAt(job.kind);
        if (finishedAt !== null) {
          job.lastFinishedAt = finishedAt;
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
        // 每轮都回读一次表：手动同步跑在 web 进程，它的 finishedAt 只落库，
        // 不刷新的话 worker 会在「刚刚手动同步完」之后又立刻跑一轮
        try {
          const finishedAt = this.latestFinishedAt(job.kind);
          if (finishedAt !== null && finishedAt > (job.lastFinishedAt ?? 0)) {
            job.lastFinishedAt = finishedAt;
          }
        } catch (error) {
          // 回读失败沿用内存值，不影响本轮调度
          console.error(`[scheduler] 回读 ${job.name} 计时失败`, error);
        }

        if (job.nextAttemptAt && now < job.nextAttemptAt) {
          continue;
        }
        if (job.lastFinishedAt && now - job.lastFinishedAt < job.intervalMs) {
          continue;
        }
        if (job.windowed && !isWithinWindow()) {
          // 被作息窗口挡下。这里不能简单地每个 tick 都问一次「到点了吗」——
          // 那会让跨夜积压的任务总在开窗那一刻准点开跑，机械感明显。
          // 改成此刻定一个随机释放点，在它到来之前不再重复问：
          // 随机数只掷一次，而不是每 30 秒重掷。
          job.nextAttemptAt = nextWindowReleaseAt() ?? undefined;
          continue;
        }
        // 抢不到锁（上一轮还在跑，或进程被 kill 后锁未到期）意味着任务并没执行，
        // 不能记成「刚跑完」——否则会白白空等一个 interval 才重试，
        // 落回下一轮 tick（30 秒后）再看即可；
        // skipped 同理：没真正抓取的一轮不应占用整个 interval，但压一个
        // 短冷却避免每 30 秒空转一次。
        const outcome = await runJob(job);
        if (outcome.skipped) {
          job.nextAttemptAt = Date.now() + SKIP_RETRY_MS;
        } else if (outcome.ran) {
          job.lastFinishedAt = Date.now();
          job.nextAttemptAt = undefined;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
