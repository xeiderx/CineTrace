"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Save } from "lucide-react";
import {
  getManualSyncProgressAction,
  saveSyncSettingsAction,
  startManualSyncAction,
  type FormState,
  type ManualSyncState,
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

/** 手动同步的轮询间隔 */
const POLL_MS = 3000;

/**
 * 豆瓣同步配置。这里只负责「怎么抓」，
 * 抓取动作本身由 worker 容器按 2 小时周期执行，
 * 也可以点「立即同步」手动跑一轮（绕过自动同步开关与作息窗口）。
 */
export function SyncSettings({
  initial,
}: {
  initial: Record<string, unknown>;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial["sync.enabled"] === true);
  const [syncWatching, setSyncWatching] = useState(
    initial["douban.syncWatching"] !== false,
  );
  const [syncWish, setSyncWish] = useState(
    initial["douban.syncWish"] !== false,
  );

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveSyncSettingsAction,
    undefined,
  );

  const [syncState, setSyncState] = useState<ManualSyncState | null>(null);
  const [starting, setStarting] = useState(false);

  // 组件卸载后不再 setState，也不继续轮询（同步本身在服务端照跑）
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const running = syncState?.running ?? false;

  /**
   * 手动立刻抓一轮。服务端立即返回并转后台执行，这里轮询到 running 变 false 为止；
   * 中途切走页面只会丢掉轮询，抓取不受影响。
   * 这里是全量入口，与概览页的「手动全量」共用同一套冷却规则——
   * 冷却期内的点击会由服务端拒绝并回显原因，不会偷偷放行。
   */
  const startSync = async () => {
    setStarting(true);
    try {
      setSyncState(await startManualSyncAction("full"));
    } finally {
      if (aliveRef.current) setStarting(false);
    }

    while (aliveRef.current) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!aliveRef.current) return;

      const next = await getManualSyncProgressAction();
      if (!aliveRef.current) return;
      setSyncState(next);
      if (!next.running) {
        // 同步会改动作品与记录，让服务端组件重新渲染
        router.refresh();
        return;
      }
    }
  };

  // 进入页面时若后台还在同步，直接接上进度显示
  useEffect(() => {
    void (async () => {
      const next = await getManualSyncProgressAction();
      if (aliveRef.current && next.running) setSyncState(next);
    })();
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-medium">豆瓣同步</h2>
        <p className="text-xs text-muted-foreground">
          抓取豆瓣「想看 / 在看 / 看过」三个列表，逐条匹配 TMDB 元数据后写入媒体库。
          worker 容器每 2 小时执行一次：常规轮只看每个列表的最新一页，遇到已有条目
          即停，所以开销极小；每周做一次完整回扫，捡回你事后修改的老评分与短评。
          首次回扫条目多、耗时较长，若撞上作息窗口结束会自动中止并记下位置，
          下次从断点继续，不会整夜连续抓取。
          重复抓取不会产生重复记录；也可以点「立即全量同步」手动跑一轮完整抓取，
          与自动全量共用 72 小时的冷却间隔。
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

        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-5">
          <div className="space-y-1">
            <Label htmlFor="douban.syncWatching">同步「在看」</Label>
            <p className="text-xs text-muted-foreground">
              抓取豆瓣「在看」列表。这个列表通常只有几十条，一轮只需一次请求。
            </p>
          </div>
          {/* 显式携带值：radix 的 bubble input 不保证提交，不能依赖 */}
          <input
            type="hidden"
            name="douban.syncWatching"
            value={syncWatching ? "true" : "false"}
          />
          <Switch
            id="douban.syncWatching"
            checked={syncWatching}
            onCheckedChange={setSyncWatching}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-5">
          <div className="space-y-1">
            <Label htmlFor="douban.syncWish">同步「想看」</Label>
            <p className="text-xs text-muted-foreground">
              抓取豆瓣「想看」列表。不想让待看片单进媒体库时关掉即可。
            </p>
          </div>
          {/* 显式携带值：radix 的 bubble input 不保证提交，不能依赖 */}
          <input
            type="hidden"
            name="douban.syncWish"
            value={syncWish ? "true" : "false"}
          />
          <Switch
            id="douban.syncWish"
            checked={syncWish}
            onCheckedChange={setSyncWish}
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
            <Label htmlFor="sync.windowJitterMin">开窗随机延迟下限（分钟）</Label>
            <Input
              id="sync.windowJitterMin"
              name="sync.windowJitterMin"
              type="number"
              min={0}
              max={180}
              step={1}
              defaultValue={num(initial["sync.windowJitterMin"], 15)}
              className="h-8 max-w-40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync.windowJitterMax">开窗随机延迟上限（分钟）</Label>
            <Input
              id="sync.windowJitterMax"
              name="sync.windowJitterMax"
              type="number"
              min={0}
              max={180}
              step={1}
              defaultValue={num(initial["sync.windowJitterMax"], 30)}
              className="h-8 max-w-40"
            />
            <p className="text-xs text-muted-foreground">
              窗口开启后，第一次抓取在这个区间内随机推迟，避免每天准点开跑。建议
              15 - 30 分钟。
            </p>
          </div>
        </div>

        <div className="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sync.minDelaySec">最小延迟（秒）</Label>
            <Input
              id="sync.minDelaySec"
              name="sync.minDelaySec"
              type="number"
              min={1}
              max={120}
              step={1}
              defaultValue={num(initial["sync.minDelaySec"], 3)}
              className="h-8 max-w-40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sync.maxDelaySec">最大延迟（秒）</Label>
            <Input
              id="sync.maxDelaySec"
              name="sync.maxDelaySec"
              type="number"
              min={1}
              max={120}
              step={1}
              defaultValue={num(initial["sync.maxDelaySec"], 8)}
              className="h-8 max-w-40"
            />
            <p className="text-xs text-muted-foreground">
              每次请求前的随机等待区间，固定节奏最容易触发风控。建议 3 - 8
              秒。
            </p>
          </div>
        </div>

        <div className="space-y-2 border-t border-border/60 pt-5">
          <Label htmlFor="tmdb.apiKey">TMDB API Key</Label>
          <Input
            id="tmdb.apiKey"
            name="tmdb.apiKey"
            type="password"
            defaultValue={str(initial["tmdb.apiKey"])}
            placeholder="v3 API Key，如 245caecb…"
            className="h-8 max-w-96"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            在{" "}
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              TMDB 账号设置
            </a>{" "}
            申请 v3 Key。保存在数据库里，web 与 worker 共用，保存后即时生效、无需重启容器；
            留空则回落到环境变量 <code>TMDB_API_KEY</code>。
          </p>
        </div>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          未配置 Key 时同步仍会抓取豆瓣数据，但条目的元数据匹配会被跳过。
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
            已保存。定时同步按新的设置执行。
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={starting || running}
            onClick={() => void startSync()}
          >
            <RefreshCw className={starting || running ? "animate-spin" : undefined} />
            {starting
              ? "启动中…"
              : running
                ? `同步中 ${syncState?.seen ?? 0}${syncState?.total ? `/${syncState.total}` : ""}…`
                : "立即全量同步"}
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            <Save />
            {pending ? "保存中…" : "保存设置"}
          </Button>
        </div>

        {syncState?.error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {syncState.error}
          </p>
        ) : null}

        {syncState && !syncState.error && syncState.message ? (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
            {syncState.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
