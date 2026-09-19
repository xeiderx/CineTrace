import { getSetting } from "@/lib/settings";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** [min, max] 区间内的随机整数 */
export function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 每次外部请求前调用：按设置里的区间随机等待。
 * 固定间隔的请求节奏最容易触发风控，随机化是成本最低的对策。
 */
export async function throttle(): Promise<void> {
  const min = getSetting("sync.minDelayMs");
  const max = getSetting("sync.maxDelayMs");
  await sleep(randomInt(min, max));
}

/** 把 "09:00" 解析为当天的分钟数，非法输入返回 null。 */
function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 当前是否处于允许抓取的时间窗口内。
 * 窗口支持跨零点（如 22:00 - 06:00）。
 * 起止时间配置非法时按「不限制」处理，避免配置写错导致同步彻底停摆。
 */
export function isWithinWindow(now = new Date()): boolean {
  const start = parseClock(getSetting("sync.windowStart"));
  const end = parseClock(getSetting("sync.windowEnd"));
  if (start === null || end === null || start === end) return true;

  const current = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
