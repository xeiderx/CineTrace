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
 * 设置以秒为单位（配置时更直观），这里换算成毫秒。
 */
export async function throttle(): Promise<void> {
  const min = getSetting("sync.minDelaySec");
  const max = getSetting("sync.maxDelaySec");
  await sleep(randomInt(min, max) * 1000);
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

/** 窗口起止分钟数；配置非法或等价于「不限制」时返回 null。 */
function windowBounds(): { start: number; end: number } | null {
  const start = parseClock(getSetting("sync.windowStart"));
  const end = parseClock(getSetting("sync.windowEnd"));
  if (start === null || end === null || start === end) return null;
  return { start, end };
}

/**
 * 当前是否处于允许抓取的时间窗口内。
 * 窗口支持跨零点（如 22:00 - 06:00）。
 * 起止时间配置非法时按「不限制」处理，避免配置写错导致同步彻底停摆。
 */
export function isWithinWindow(now = new Date()): boolean {
  const bounds = windowBounds();
  if (bounds === null) return true;

  const current = now.getHours() * 60 + now.getMinutes();
  return bounds.start < bounds.end
    ? current >= bounds.start && current < bounds.end
    : current >= bounds.start || current < bounds.end;
}

/**
 * 下一次窗口开启的时刻（毫秒时间戳）；窗口不限制时返回 null。
 * 仅在窗口外调用才有意义——窗口内调用会得到「明天的开窗点」。
 */
export function nextWindowOpenAt(now = new Date()): number | null {
  const bounds = windowBounds();
  if (bounds === null) return null;

  const target = new Date(now);
  target.setHours(Math.floor(bounds.start / 60), bounds.start % 60, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

/**
 * 窗口外的任务该在什么时刻重试：开窗点再随机推迟若干分钟。
 *
 * 为什么需要随机：跨夜积压的第一轮如果总在开窗那一刻准点开跑，
 * 天天如此就是很明显的机械特征；随机化让起跑时间散开。
 *
 * 为什么不能直接改 isWithinWindow：它每隔一个 tick 就被调用一次，
 * 在里面取随机数等于每 30 秒重掷一次骰子，起不到任何作用——
 * 随机目标必须在「任务被挡下」时定一次，之后不再变化。
 *
 * 随机量可能把时刻推出窗口之外（窗口比延迟还窄的极端配置），
 * 此时退回开窗点本身，保证任务不会因为随机化而永远等不到执行。
 */
export function nextWindowReleaseAt(now = new Date()): number | null {
  const openAt = nextWindowOpenAt(now);
  if (openAt === null) return null;

  const jittered = openAt + randomInt(getSetting("sync.windowJitterMin"), getSetting("sync.windowJitterMax")) * 60_000;
  return isWithinWindow(new Date(jittered)) ? jittered : openAt;
}
