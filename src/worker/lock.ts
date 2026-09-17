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

/** 包一层自动释放，任务体无论成功失败都不会把锁留着。 */
export async function withLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!acquireLock(name, ttlMs)) return null;
  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}
