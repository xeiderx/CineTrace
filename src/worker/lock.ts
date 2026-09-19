import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { taskLock } from "@/db/schema";

/** 每个 worker 进程一个标识，用于确认锁是不是自己持有的 */
export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * 基于数据库的互斥锁。
 * web 与 worker 是两个容器，内存锁彼此不可见，所以必须落库。
 * 锁带过期时间：进程被 kill 时不会留下永远解不开的死锁。
 */
export function acquireLock(name: string, ttlMs: number): boolean {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  db.delete(taskLock)
    .where(and(eq(taskLock.name, name), lt(taskLock.expiresAt, now)))
    .run();

  const inserted = db
    .insert(taskLock)
    .values({ name, owner: WORKER_ID, acquiredAt: now, expiresAt })
    .onConflictDoNothing()
    .run();

  return inserted.changes > 0;
}

/** 只释放自己持有的锁，避免误释别的进程刚抢到的锁。 */
export function releaseLock(name: string): void {
  db.delete(taskLock)
    .where(and(eq(taskLock.name, name), eq(taskLock.owner, WORKER_ID)))
    .run();
}

/**
 * 续租：把过期时间往后推，但仍限定只有持有者能推。
 * 任务耗时可能远超 TTL——首次全量要回扫两千多条、上百页，
 * 只能给 TTL 定个「够用的初值」再靠续租撑住；
 * 没有续租的话，长任务会在跑完前丢锁，另一进程趁机抢锁抓同一个账号。
 */
function renewLock(name: string, ttlMs: number): void {
  db.update(taskLock)
    .set({ expiresAt: new Date(Date.now() + ttlMs) })
    .where(and(eq(taskLock.name, name), eq(taskLock.owner, WORKER_ID)))
    .run();
}

/** 包一层自动续租与释放，任务体无论成功失败都不会把锁留着。 */
export async function withLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!acquireLock(name, ttlMs)) return null;
  // 每 TTL 的三分之一续租一次，留足容错余量再兜底 30 秒下限
  const renewTimer = setInterval(
    () => renewLock(name, ttlMs),
    Math.max(30_000, Math.floor(ttlMs / 3)),
  );
  try {
    return await fn();
  } finally {
    clearInterval(renewTimer);
    releaseLock(name);
  }
}
