import { isWithinWindow } from "./throttle";
import { runJob, type Job } from "./job";

/** 调度器轮询间隔：每次 tick 只做轻量的时间比较，不做网络请求 */
const TICK_MS = 30_000;

type ScheduledJob = Job & {
  /** 受作息窗口与总开关约束的任务（即所有对外抓取任务） */
  windowed?: boolean;
  /** 上次执行结束的时间戳，仅进程内可见 */
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
    // 启动后立即跑一轮，不必等第一个 tick
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
        await runJob(job);
        job.lastFinishedAt = Date.now();
      }
    } finally {
      this.running = false;
    }
  }
}
