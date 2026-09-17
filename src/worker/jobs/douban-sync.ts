import { getSetting } from "@/lib/settings";
import type { Job } from "../job";

/**
 * 豆瓣观影记录同步。
 * 抓取与解析在 Phase 0 已跑通（见 reference/phase0-*.mjs），
 * 这里只固定任务契约：读配置 → 判断能否执行 → 交由后续实现落库。
 */
export const doubanSyncJob: Job = {
  name: "douban-sync",
  kind: "douban-html",
  intervalMs: 6 * 60 * 60 * 1000,
  // 2100 条记录分页抓取耗时较长，锁的存活时间给足
  lockTtlMs: 30 * 60 * 1000,
  async run() {
    if (!getSetting("sync.enabled")) {
      return { message: "同步开关已关闭，跳过" };
    }

    const uid = String(getSetting("douban.uid") ?? "").trim();
    if (!uid) {
      return { partial: true, message: "未配置豆瓣用户 ID，跳过抓取" };
    }

    // TODO(Phase 2): 接入 list/detail 抓取 → 解析 → TMDB 匹配 → 落 work/view_record
    return { partial: true, message: "抓取管线尚未接入" };
  },
};
