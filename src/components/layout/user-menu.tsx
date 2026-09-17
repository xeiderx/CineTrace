"use client";

import { LogOut, Settings, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { logoutAction } from "@/app/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** 侧边栏底部的用户入口：展示账号、进入设置、退出登录 */
export function UserMenu({ username }: { username: string }) {
  const [pending, startTransition] = useTransition();

  const initial = username.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-3 px-2 py-2"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
            {username}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-52">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
          <UserIcon className="size-3.5" />
          已登录
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4" />
            设置
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={() => startTransition(() => void logoutAction())}
        >
          <LogOut className="size-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
