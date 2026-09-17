import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasNoUser } from "@/app/actions/auth";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "初始化" };

export default async function SetupPage() {
  // 已有账号则不允许重复初始化
  if (!(await hasNoUser())) {
    redirect("/login");
  }

  return <AuthForm mode="setup" />;
}
