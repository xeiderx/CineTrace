import { randomInt } from "@/lib/window";
import { getSetting } from "@/lib/settings";

/**
 * 作息窗口相关的纯函数已下沉到 `@/lib/window`，这里原样转出去，
 * 保持 worker 各处的 `from "../throttle"` 引用不变。
 */
export { isWithinWindow, nextWindowOpenAt, nextWindowReleaseAt, randomInt } from "@/lib/window";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
