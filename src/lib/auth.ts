import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { session, user } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { SESSION_TTL_MS } from "@/lib/session-constants";
import { createToken, hashToken } from "@/lib/token";

export { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session-constants";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string | null;
};

/**
 * 校验账号密码。成功返回用户信息，失败返回 null。
 * 单用户场景，但仍按 id 最小的用户处理，避免历史残留多行时行为不确定。
 */
export async function authenticate(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const row = db.select().from(user).where(eq(user.username, username)).get();
  if (!row) return null;

  const ok = await verifyPassword(row.passwordHash, password);
  if (!ok) return null;

  db.update(user)
    .set({ lastLoginAt: new Date() })
    .where(eq(user.id, row.id))
    .run();

  return { id: row.id, username: row.username, displayName: row.displayName ?? null };
}

/** 创建会话并返回写入 Cookie 的明文 token（库里只存哈希） */
export function createSession(
  userId: number,
  meta: { userAgent?: string; ip?: string } = {},
): { token: string; expiresAt: Date } {
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  db.insert(session)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(token),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    })
    .run();

  return { token, expiresAt };
}

/** 用 Cookie 里的明文 token 换当前用户；过期或不存在则返回 null */
export function getSessionUser(token: string | undefined): AuthUser | null {
  if (!token) return null;

  const row = db
    .select({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(
      and(
        eq(session.tokenHash, hashToken(token)),
        gt(session.expiresAt, new Date()),
      ),
    )
    .get();

  if (!row) return null;

  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName ?? null,
  };
}

/** 退出登录：删掉这一条会话 */
export function destroySession(token: string | undefined): void {
  if (!token) return;
  db.delete(session).where(eq(session.tokenHash, hashToken(token))).run();
}

/** 清理过期会话。由 worker 定时调用，避免表无限膨胀。 */
export function purgeExpiredSessions(): number {
  const result = db.delete(session).where(lt(session.expiresAt, new Date())).run();
  return result.changes;
}
