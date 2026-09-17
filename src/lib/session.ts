import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE, type AuthUser } from "@/lib/auth";

/**
 * 取当前登录用户。
 * middleware 只检查 Cookie 是否存在，这里做真正的会话校验——
 * Cookie 可能是伪造或已过期的，必须以数据库为准。
 * 未登录直接跳登录页。
 */
export async function requireUser(): Promise<AuthUser> {
  const store = await cookies();
  const authUser = getSessionUser(store.get(SESSION_COOKIE)?.value);
  if (!authUser) redirect("/login");
  return authUser;
}

/** 取当前用户但不跳转，允许为 null */
export async function getOptionalUser(): Promise<AuthUser | null> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
}
