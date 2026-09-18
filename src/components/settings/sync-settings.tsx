"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";
import {
  saveSyncSettingsAction,
  type FormState,
} from "@/app/actions/sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** 从 getSettings() 的宽类型里安全取值 */
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 豆瓣同步配置。这里只负责「怎么抓」，
 * 抓取动作本身由 worker 容器按 6 小时周期执行。
 */
export function SyncSettings({
  initial,
}: {
  initial: Record<string, unknown>;
}) {
  const [enabled, setEnabled] = useState(initial["sync.enabled"] === true);

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveSyncSettingsAction,
    undefined,
  );

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-medium">豆瓣同步</h2>
        <p className="text-xs text-muted-foreground">
          抓取豆瓣「我看过的」列表，逐条匹配 TMDB 元数据后写入媒体库。worker
          容器每 6 小时执行一次，重复抓取不会产生重复记录。
        </p>
      </div>

      <form
        action={formAction}
        className="space-y-5 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      >
        <div className="space-y-2">
          <Label htmlFor="douban.uid">豆瓣 ID *</Label>
          <Input
            id="douban.uid"
            name="douban.uid"
            defaultValue={str(initial["douban.uid"])}
            placeholder="如 12345678"
            className="h-8 max-w-72"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            个人主页地址里 <code>people/</code> 后面那一段，也支持自定义字母
            ID。
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-5">
          <div className="space-y-1">
            <Label htmlFor="sync.enabled">启用自动同步</Label>
            <p className="text-xs text-muted-foreground">
              关闭后 worker 不会向豆瓣发出任何请求，已有的记录不受影响。
            </p>
          </div>
          {/* 显式携带值：radix 的 bubble input 不保证提交，不能依赖 */}
          <input
            type="hidden"
            name="sync.enabled"
            value={enabled ? "true" : "false"}
          />
          <Switch
            id="sync.enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sync.windowStart">窗口开始</Label>
            <Input
              id="sync.windowStart"
              name="sync.windowStart"
              type="time"
              defaultValue={str(initial["sync.windowStart"], "09:00")}
              className="h-8 max-w-40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync.windowEnd">窗口结束</Label>
            <Input
              id="sync.windowEnd"
              name="sync.windowEnd"
              type="time"
              defaultValue={str(initial["sync.windowEnd"], "23:00")}
              className="h-8 max-w-40"
            />
            <p className="text-xs text-muted-foreground">
              只在这个时段内抓取，避开深夜。支持跨零点，如 22:00 - 06:00。
            </p>
          </div>
        </div>

        <div className="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sync.minDelayMs">最小延迟（毫秒）</Label>
            <Input
              id="sync.minDelayMs"
              name="sync.minDelayMs"
              type="number"
              min={500}
              max={120_000}
              step={100}
              defaultValue={num(initial["sync.minDelayMs"], 3000)}
              className="h-8 max-w-40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync.maxDelayMs">最大延迟（毫秒）</Label>
            <Input
              id="sync.maxDelayMs"
              name="sync.maxDelayMs"
              type="number"
              min={500}
              max={120_000}
              step={100}
              defaultValue={num(initial["sync.maxDelayMs"], 8000)}
              className="h-8 max-w-40"
            />
            <p className="text-xs text-muted-foreground">
              每次请求前的随机等待区间，固定节奏最容易触发风控。
            </p>
          </div>
        </div>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          匹配 TMDB 需要容器里配置环境变量 <code>TMDB_API_KEY</code>；缺失时
          同步仍会抓取豆瓣数据，但条目的元数据匹配会被跳过。
        </p>

        {state?.error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        {state?.ok ? (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
            已保存。下次 worker 调度时生效。
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            <Save />
            {pending ? "保存中…" : "保存设置"}
          </Button>
        </div>
      </form>
    </div>
  );
}
