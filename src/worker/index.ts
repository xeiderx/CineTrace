import { dbPath } from "@/db";
import { Scheduler } from "./scheduler";
import { sessionCleanupJob } from "./jobs/session-cleanup";
import { doubanSyncJob } from "./jobs/douban-sync";

/**
 * worker 常驻进程：只做后台任务，不对外提供 HTTP。
 * 与 web 容器共享同一份 SQLite 卷，靠 task_lock 表互斥。
 */
const scheduler = new Scheduler()
  // 抓取类任务受 sync.enabled 与作息窗口约束
  .add({ ...doubanSyncJob, windowed: true })
  // 维护类任务纯本地操作，随时可跑
  .add(sessionCleanupJob);

console.log(`[worker] 启动，数据库：${dbPath}`);
scheduler.start();

/** 容器收到 SIGTERM 时优雅退出，让正在执行的任务把锁与记录写完 */
function shutdown(signal: string) {
  console.log(`[worker] 收到 ${signal}，停止调度`);
  scheduler.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
