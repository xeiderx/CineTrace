import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasNoUser } from "@/app/actions/auth";
import { getOptionalUser } from "@/lib/session";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  // 尚无任何账号时，直接引导创建，避免用户对着登录框无账号可用
  if (await hasNoUser()) {
    redirect("/setup");
  }

  // 已登录用户访问登录页才送回首页。必须查库确认会话真的有效：
  // 只看 Cookie 是否存在会把「持有失效会话」的用户锁进
  // 首页 ↔ 登录页 的无限重定向（浏览器报 ERR_TOO_MANY_REDIRECTS）。
  if (await getOptionalUser()) {
    redirect("/");
  }

  return <AuthForm mode="login" next={next} />;
}
