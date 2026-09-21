"use client";

import { useTransition } from "react";
import { Ban, Bookmark, CirclePause, CirclePlay, Ellipsis, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setViewRecordStatusAction } from "@/app/actions/library";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { viewStatusLabel, type ViewStatus } from "@/lib/labels";

/**
 * 本地可切的目标状态。四个目标里，豆瓣同步只会产出在看/想看，
 * 搁置与弃看只能在这儿设。
 */
const TARGETS: { value: ViewStatus; icon: typeof CirclePlay; hint: string }[] = [
  { value: "watching", icon: CirclePlay, hint: "回到在看列表" },
  { value: "wish", icon: Bookmark, hint: "先记下来，想看了再开追" },
  { value: "on_hold", icon: CirclePause, hint: "先放着，之后接着追" },
  { value: "dropped", icon: Ban, hint: "不追了，从在看里移出" },
];

/**
 * 卡片上的状态快捷切换。
 *
 * 只出现在追剧页：在那儿「不想追了」是一念之间的事，不该逼用户进详情页开面板。
 * 菜单里列出的是除当前状态之外的目标，避免出现一个点了没反应的选项。
 */
export function WatchingStatusMenu({
  recordId,
  status,
  label,
}: {
  /** 决定这条剧归到哪个标签页的那笔流水 */
  recordId: number;
  /** 当前状态，用来决定菜单里显示哪些目标 */
  status: ViewStatus;
  /** 作品名，用于读屏文案 */
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  function change(next: ViewStatus): void {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", String(recordId));
      formData.set("status", next);
      const state = await setViewRecordStatusAction(undefined, formData);
      if (state?.error) {
        toast.error(state.error);
        return;
      }
      if (state?.message) toast.success(state.message);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          className="shrink-0 text-muted-foreground"
          title="切换观看状态"
          aria-label={`切换《${label}》的观看状态`}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Ellipsis />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>当前：{viewStatusLabel(status)}</DropdownMenuLabel>
        {TARGETS.filter((target) => target.value !== status).map((target) => {
          const Icon = target.icon;
          return (
            <DropdownMenuItem
              key={target.value}
              onSelect={() => change(target.value)}
              className="flex-col items-start gap-0"
            >
              <span className="flex items-center gap-1.5">
                <Icon className="size-3.5" />
                改为{viewStatusLabel(target.value)}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {target.hint}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
