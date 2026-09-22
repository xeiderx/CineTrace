"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw } from "lucide-react";
import {
  getManualSyncProgressAction,
  getSyncCardsStateAction,
  startManualSyncAction,
  type ManualSyncState,
} from "@/app/actions/sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  manualSyncBlocker,
  type SyncCardsState,
  type SyncMode,
} from "@/lib/sync-status";

/** 进度轮询间隔，与设置页保持一致 */
const POLL_MS = 3000;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * 倒计时显示。一小时以上只到分钟（全量冷却最长 72 小时，显示秒没有意义），
 * 不足一小时才降到 MM:SS，让「马上就好了」这件事看得出在动。
 */
function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** 冷却结束的绝对时刻，如 09-22 14:30 */
function formatReadyAt(at: number): string {
  const date = new Date(at);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type CardSpec = {
  mode: SyncMode;
  label: string;
  icon: typeof RefreshCw;
  hint: string;
  countdownLabel: string;
  action: string;
  /** 自动轮的预计放行时刻 */
  autoAt: number;
  /** 手动轮的冷却解除时刻 */
  readyAt: number;
};

/**
 * 概览页的两个手动同步入口。
 *
 * 倒计时由服务端算好锚点（见 lib/sync-status），这里只按秒重绘——
 * 客户端算不出「自动轮还差多久」，那要看 sync_run 与作息窗口。
 * 服务端返回的 now 用来校正两端时钟：容器时间与浏览器时间不一致时，
 * 直接拿 Date.now() 去减会算出一个偏离很久的倒计时。
 *
 * 冷却只管住按钮，拦不住别的入口，所以真正的闸门在 action 一侧，
 * 这里被绕过也只会拿到一句中文提示而不是真的多点一次抓取。
 */
export function SyncCards({ initial }: { initial: SyncCardsState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  /** 客户端当前时间；首帧为 null，等挂载后再渲染倒计时，避免两端时间不一致导致水合不匹配 */
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ManualSyncState | null>(null);
  /** 最近一次触发的是哪张卡。进度与报错只该显示在它自己身上 */
  const [activeMode, setActiveMode] = useState<SyncMode | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 时钟偏差只在服务端状态刷新时重算，平时每秒只推进本地时间
  const offsetRef = useRef(0);
  useEffect(() => {
    offsetRef.current = state.now - Date.now();
  }, [state.now]);

  useEffect(() => {
    const update = () => setNow(Date.now() + offsetRef.current);
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  // 挂载时后台可能已经有一轮在跑（worker 定时任务或别的标签页），接上它的进度。
  // 这种来路不明的轮次不认领 activeMode：两张卡都显示「同步中」即可，
  // 报错与进度落到具体某一张上反而会误导。
  useEffect(() => {
    void (async () => {
      const next = await getManualSyncProgressAction();
      if (aliveRef.current && next.running) setProgress(next);
    })();
  }, []);

  const refresh = useCallback(async () => {
    const next = await getSyncCardsStateAction();
    if (aliveRef.current) setState(next);
  }, []);

  const start = async (mode: SyncMode) => {
    if (busy) return;
    setBusy(true);
    setActiveMode(mode);
    setProgress(null);
    try {
      const first = await startManualSyncAction(mode);
      if (!aliveRef.current) return;
      setProgress(first);
      if (first.error) return;

      // 抓取跑在服务端，这里只负责把进度显示到结束
      while (aliveRef.current) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!aliveRef.current) return;
        const next = await getManualSyncProgressAction();
        if (!aliveRef.current) return;
        setProgress(next);
        if (!next.running) break;
      }

      await refresh();
      router.refresh();
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const cards: CardSpec[] = [
    {
      mode: "full",
      label: "全量更新",
      icon: RotateCcw,
      hint: "完整回扫全部列表，捡回你事后修改的老评分与短评",
      countdownLabel: "距自动全量",
      action: "立即全量",
      autoAt: state.nextFullAutoAt,
      readyAt: state.manualFullReadyAt,
    },
    {
      mode: "incremental",
      label: "增量更新",
      icon: RefreshCw,
      hint: "只抓最新一页，拿你刚在豆瓣标记或打分的条目",
      countdownLabel: "距自动更新",
      action: "立即更新",
      autoAt: state.nextIncrementalAutoAt,
      readyAt: state.manualIncrementalReadyAt,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        // now 为 null（尚未挂载）时按「不可点」渲染，与挂载后的判定结果一致
        const blocker =
          now === null
            ? "读取中"
            : manualSyncBlocker(state, card.mode, now);
        const cooldownRemainMs =
          now === null ? 0 : Math.max(0, card.readyAt - now);
        const autoRemainMs = now === null ? 0 : Math.max(0, card.autoAt - now);

        // 只要有同步在跑，两张卡的按钮都该禁掉：它们是同一把锁，
        // 点了也只会被服务端拒绝。区别只在状态行——进度数字与报错
        // 只属于触发它的那张卡，另一张笼统说「同步中」就够了。
        const mine = activeMode === card.mode;
        const isRunning = busy || (progress?.running ?? false) || state.running;

        // 风控退避提示只挂在增量卡上：自动轮的间隔是被它拉长的，
        // 而用户看到的正是那张卡的倒计时。全量卡另有 72 小时冷却，
        // 一并堆上去只会让提示串成一片，反而看不出重点。
        const blockedHint =
          card.mode === "incremental" && state.blocked
            ? `检测到豆瓣限制访问${state.blockedAt > 0 ? `（${formatReadyAt(state.blockedAt)}）` : ""}，自动更新已临时放慢到 6 小时一轮，${formatReadyAt(state.nextIncrementalAutoAt)} 后重试`
            : null;

        // 状态行只讲一件事：为什么不能点，或者下一步会发生什么
        let status: string;
        if (mine && progress?.error) status = progress.error;
        else if (!state.configured) status = "请先在设置里填好豆瓣 ID 与 TMDB API Key";
        else if (isRunning) {
          const seen = mine ? (progress?.seen ?? 0) : 0;
          const total = mine ? progress?.total : null;
          status = `同步中${seen > 0 ? ` ${seen}${total ? `/${total}` : ""}` : ""}…`;
        } else if (blocker) {
          status = `冷却剩余 ${formatCountdown(cooldownRemainMs)}，${formatReadyAt(card.readyAt)} 后可用`;
        } else if (mine && progress?.message) {
          status = progress.message;
        } else {
          status = "现在可以手动触发";
        }

        return (
          <Card key={card.mode} className="gap-0">
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon className="size-4 text-primary/70" />
                    <span>{card.label}</span>
                  </div>
                  <div className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
                    {now === null ? "--:--" : formatCountdown(autoRemainMs)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {card.countdownLabel}
                  </p>
                </div>

                {isRunning ? (
                  <Button size="sm" variant="outline" disabled>
                    <RefreshCw className="animate-spin" />
                    同步中…
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={blocker !== null}
                    title={blocker ?? undefined}
                    onClick={() => void start(card.mode)}
                  >
                    <Icon />
                    {card.action}
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">{card.hint}</p>
              {blockedHint && (
                <p className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
                  {blockedHint}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{status}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
