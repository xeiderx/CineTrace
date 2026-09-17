import { purgeExpiredSessions } from "@/lib/auth";
import type { Job } from "../job";

/** 清理过期会话，避免 session 表无限膨胀。纯本地操作，不受作息窗口约束。 */
export const sessionCleanupJob: Job = {
  name: "session-cleanup",
  kind: "maintenance",
  intervalMs: 6 * 60 * 60 * 1000,
  lockTtlMs: 60_000,
  async run() {
    const removed = purgeExpiredSessions();
    return { itemsUpdated: removed, message: `清理过期会话 ${removed} 条` };
  },
};
