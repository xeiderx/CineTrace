"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { authenticate, createSession, destroySession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { SESSION_COOKIE } from "@/lib/session-constants";

export type ActionState = { error?: string } | undefined;

/** 是否还没有任何账号——用于决定是否走首次引导流程 */
export async function hasNoUser(): Promise<boolean> {
  const result = db.select({ value: count() }).from(user).get();
  return (result?.value ?? 0) === 0;
}

async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // NAS 内网直连时是 http，故不能强制 secure；经 Cloudflare Tunnel 访问时由隧道保证
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
}

/** 登录。成功后写 Cookie 并跳转；失败返回错误信息给表单 */
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!username || !password) {
    return { error: "请输入账号与密码" };
  }

  const authUser = await authenticate(username, password);
  if (!authUser) {
    // 不区分「账号不存在」与「密码错误」，避免账号枚举
    return { error: "账号或密码不正确" };
  }

  const { token, expiresAt } = createSession(authUser.id);
  await setSessionCookie(token, expiresAt);

  // 只允许跳回站内路径
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

/** 首次启动：创建唯一的管理员账号 */
export async function setupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await hasNoUser())) {
    return { error: "账号已存在，请直接登录" };
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (username.length < 2) return { error: "账号至少 2 个字符" };
  if (password.length < 8) return { error: "密码至少 8 位" };
  if (password !== confirm) return { error: "两次输入的密码不一致" };

  const inserted = db
    .insert(user)
    .values({
      username,
      passwordHash: await hashPassword(password),
      displayName: username,
    })
    .returning({ id: user.id })
    .get();

  const { token, expiresAt } = createSession(inserted.id);
  await setSessionCookie(token, expiresAt);

  redirect("/");
}

/** 退出登录 */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  destroySession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

/** 修改密码：需先验证当前密码 */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return { error: "新密码至少 8 位" };
  if (next !== confirm) return { error: "两次输入的新密码不一致" };

  const row = db.select().from(user).get();
  if (!row) return { error: "账号不存在" };

  if (!(await verifyPassword(row.passwordHash, current))) {
    return { error: "当前密码不正确" };
  }

  db.update(user)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(user.id, row.id))
    .run();

  return {};
}
