"use client";

import { useActionState } from "react";
import { Lock, User } from "lucide-react";
import { loginAction, setupAction, type ActionState } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_VERSION_LABEL } from "@/lib/version";

/** 首次启动时的引导文案与登录略有不同，共用同一个表单组件 */
export function AuthForm({
  mode,
  next,
}: {
  mode: "login" | "setup";
  next?: string;
}) {
  const isSetup = mode === "setup";
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    isSetup ? setupAction : loginAction,
    undefined,
  );

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur-xl">
      <CardContent className="pt-7">
        <BrandMark className="mb-7" size={36} subtitle={APP_VERSION_LABEL} />

        <h1 className="text-xl font-semibold tracking-tight">
          {isSetup ? "创建你的账号" : "欢迎回来"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {isSetup
            ? "首次使用，请设置登录账号与密码。数据全部保存在你自己的设备上。"
            : "登录后即可查看你的观影档案。"}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          <div className="space-y-2">
            <Label htmlFor="username">账号</Label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                name="username"
                autoComplete="username"
                placeholder="请输入账号"
                className="h-11 pl-9"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSetup ? "new-password" : "current-password"}
                placeholder={isSetup ? "至少 8 位" : "请输入密码"}
                className="h-11 pl-9"
                required
              />
            </div>
          </div>

          {isSetup ? (
            <div className="space-y-2">
              <Label htmlFor="confirm">确认密码</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再输入一次"
                  className="h-11 pl-9"
                  required
                />
              </div>
            </div>
          ) : null}

          {state?.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={pending}>
            {pending ? "处理中…" : isSetup ? "创建并进入" : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
