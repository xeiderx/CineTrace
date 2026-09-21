"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  removeEpisodeAction,
  saveEpisodeAction,
  setSeasonProgressAction,
} from "@/app/actions/library";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

/** 面板需要的季数据。由服务端从 `SeasonStats` 裁剪而来，不带数据库对象 */
export type PanelSeason = {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  /** 已看集号，升序 */
  watchedEpisodes: number[];
  completed: boolean;
  /** 完成判定的来源：本地进度看齐 / 豆瓣标记看过 */
  completionSource: "progress" | "douban" | null;
};

type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;

/**
 * 逐集进度面板。
 *
 * 主操作是全季语义：点集号网格的第 K 格 = 本季进度设为「已看 1..K」。
 * 跳集/取消单集这类零散操作交给「单集模式」开关，避免默认行为被误触——
 * 默认语义下点第 3 格会把第 4 集往后全清掉，这是刻意的：点第 3 格要的就是
 * 「就停在这里」，留着更大的集号会立刻把进度又顶回去。
 *
 * 服务端 action 每次都会刷新详情页，网格跟着 `seasons` 重新下发，因此这里
 * 不缓存已看集号，全部从 props 派生。
 */
export function SeasonProgressPanel({
  workId,
  seasons,
  initialSeason,
  today,
  trigger,
}: {
  workId: number;
  seasons: PanelSeason[];
  /** 打开面板时默认展示哪一季 */
  initialSeason: number;
  /** 本地时区的今天，作为标记日期的默认值 */
  today: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [seasonNumber, setSeasonNumber] = useState(initialSeason);
  const [watchedAt, setWatchedAt] = useState(today);
  const [singleMode, setSingleMode] = useState(false);
  const [pending, startTransition] = useTransition();

  const season =
    seasons.find((s) => s.seasonNumber === seasonNumber) ?? seasons[0] ?? null;

  // seasons 会在服务端刷新后变化；季被删掉或号变了就退回第一季，避免整块空掉
  if (!season) {
    return <>{trigger}</>;
  }

  const watched = new Set(season.watchedEpisodes);
  const total = season.episodeCount;
  const lastWatched =
    season.watchedEpisodes.length > 0
      ? season.watchedEpisodes[season.watchedEpisodes.length - 1]
      : 0;
  const watchedCount = season.watchedEpisodes.length;
  const nextEpisode = lastWatched + 1;
  const hasNextEpisode = total > 0 ? nextEpisode <= total : false;
  // 下一个还没看完的季。整季看完后提示「前往」，省去回列表再点一次
  const nextSeason =
    seasons.find((s) => s.seasonNumber > season.seasonNumber && !s.completed) ?? null;

  function buildFormData(): FormData {
    const formData = new FormData();
    formData.set("workId", String(workId));
    formData.set("seasonNumber", String(season!.seasonNumber));
    formData.set("watchedAt", watchedAt);
    return formData;
  }

  /**
   * 提交并反馈。`completesSeason` 为 true 且存在下一季时，
   * toast 里直接给出「前往」按钮，切到下一季继续标。
   */
  function run(
    task: () => Promise<ActionState>,
    completesSeason = false,
  ): void {
    startTransition(async () => {
      const state = await task();
      if (state?.error) {
        toast.error(state.error);
        return;
      }
      if (!state?.message) return;

      if (completesSeason && nextSeason) {
        toast.success(state.message, {
          description: `下一季是${nextSeason.name}`,
          action: {
            label: "前往",
            onClick: () => setSeasonNumber(nextSeason.seasonNumber),
          },
        });
        return;
      }
      toast.success(state.message);
    });
  }

  /** 把本季进度设为「已看 1..last 集」。`last = 0` 即清空本季 */
  function markTo(last: number, completesSeason = false): void {
    run(() => {
      const formData = buildFormData();
      formData.set("lastEpisode", String(last));
      return setSeasonProgressAction(undefined, formData);
    }, completesSeason);
  }

  function toggleEpisode(episodeNumber: number): void {
    if (watched.has(episodeNumber)) {
      run(async () => {
        const formData = buildFormData();
        formData.set("episodeNumber", String(episodeNumber));
        await removeEpisodeAction(formData);
        return { ok: true, message: `已取消第 ${episodeNumber} 集` };
      });
      return;
    }
    run(() => {
      const formData = buildFormData();
      formData.set("episodeNumber", String(episodeNumber));
      return saveEpisodeAction(undefined, formData);
    });
  }

  function handleCellClick(episodeNumber: number): void {
    if (singleMode) {
      toggleEpisode(episodeNumber);
      return;
    }
    // 再点一次末格 = 撤销一集，免得为了取消还得切到单集模式
    if (episodeNumber === lastWatched) {
      markTo(episodeNumber - 1);
      return;
    }
    markTo(episodeNumber);
  }

  const seasonNumbers = seasons.map((s) => s.seasonNumber);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {season.name}
            {season.completed ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-4xl bg-primary/15 px-2 text-xs font-medium text-primary">
                <Check className="size-3" />
                {season.completionSource === "douban" ? "豆瓣标记已看完" : "已看完"}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            点集号即把进度记到那一集；已看过的格子再点一次可撤销一集。
          </DialogDescription>
        </DialogHeader>

        {seasons.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {seasonNumbers.map((n) => {
              const target = seasons.find((s) => s.seasonNumber === n)!;
              return (
                <Button
                  key={n}
                  type="button"
                  size="xs"
                  variant={n === season.seasonNumber ? "secondary" : "ghost"}
                  onClick={() => setSeasonNumber(n)}
                >
                  第 {n} 季
                  {target.completed ? <Check className="size-3" /> : null}
                </Button>
              );
            })}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {total > 0 ? `已看 ${watchedCount}/${total} 集` : `已看 ${watchedCount} 集`}
            </span>
            {lastWatched > 0 ? <span>最近记到第 {lastWatched} 集</span> : null}
          </div>
          <Progress value={total > 0 ? (watchedCount / total) * 100 : 0} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="progress-watched-at" className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5" />
            标记日期
          </Label>
          <Input
            id="progress-watched-at"
            type="date"
            value={watchedAt}
            max={today}
            onChange={(event) => setWatchedAt(event.target.value || today)}
          />
          <p className="text-xs text-muted-foreground">
            新补的集数都记在这一天；已标好的集数保留各自原来的日期。
          </p>
        </div>

        {total > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                集号
              </span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                单集模式
                <Switch
                  size="sm"
                  checked={singleMode}
                  onCheckedChange={setSingleMode}
                />
              </label>
            </div>
            <div className="grid max-h-56 grid-cols-8 gap-1.5 overflow-y-auto rounded-lg border border-border/70 p-2 sm:grid-cols-10">
              {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={pending}
                  onClick={() => handleCellClick(n)}
                  aria-label={`第 ${n} 集${watched.has(n) ? "，已看过" : ""}`}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-md text-xs font-medium tabular-nums transition-colors disabled:opacity-60",
                    watched.has(n)
                      ? "bg-primary text-primary-foreground hover:bg-primary/80"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/20",
                    !singleMode && n === nextEpisode
                      ? "ring-2 ring-primary/40"
                      : null,
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {singleMode
                ? "单集模式：点一格只切换这一集，不动其他集。"
                : "点第 K 格 = 记到第 K 集，其后的集数会被清掉。"}
            </p>
          </div>
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            TMDB 没有给出这一季的集数，无法逐集标记。可以在观影记录里手填「第几集」。
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {hasNextEpisode ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => markTo(nextEpisode, nextEpisode === total)}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              标记第 {nextEpisode} 集
            </Button>
          ) : null}
          {total > 0 && !season.completed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => markTo(total, true)}
            >
              <Check />
              整季看完
            </Button>
          ) : null}
          {watchedCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => markTo(0)}
            >
              清空本季
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
