"use client";

import { useActionState, useState, useTransition } from "react";
import { Search, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import {
  rematchViewRecordAction,
  searchTmdbAction,
  type MatchState,
  type SearchState,
  type TmdbCandidate,
} from "@/app/actions/library";
import { Badge } from "@/components/ui/badge";
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
import { mediaTypeLabel } from "@/lib/labels";

/**
 * 把单条观影流水重新匹配到正确的 TMDB 条目。
 *
 * 与作品粒度的「重新匹配」不同：这里只动这一条流水，把它从当前作品上拆下来
 * 改挂到目标条目，当前作品本身与它的其它流水都不受影响。
 * 典型场景是把错挂到某部剧某一季上的条目（如剧场版）拆出去重新指认。
 *
 * 目标条目库里没有时会按 TMDB 详情新建一部作品，所以选的其实是「条目」而非「作品」。
 */
export function ViewRecordMatchDialog({
  recordId,
  workTitle,
  mediaType,
  progressSeason,
}: {
  recordId: number;
  /** 当前归属作品的片名，作为搜索框默认值 */
  workTitle: string;
  mediaType: string;
  /** 这条流水当前所在的季，仅剧集有意义 */
  progressSeason: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, searchAction, searching] = useActionState<SearchState, FormData>(
    searchTmdbAction,
    undefined,
  );

  // 选中的候选项正在处理时的 key，用来在列表里标出「处理中」
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [matching, startMatch] = useTransition();
  const [matchError, setMatchError] = useState<string | null>(null);
  // 换过去以后落在第几季。目标条目可能是电影，那时季号无意义、由 action 忽略
  const [season, setSeason] = useState(progressSeason != null ? String(progressSeason) : "");

  function choose(candidate: TmdbCandidate) {
    const key = `${candidate.mediaType}:${candidate.tmdbId}`;
    setMatchError(null);
    setPendingKey(key);

    const formData = new FormData();
    formData.set("id", String(recordId));
    formData.set("tmdbId", String(candidate.tmdbId));
    formData.set("mediaType", candidate.mediaType);
    formData.set("title", candidate.title);
    formData.set("progressSeason", season);

    startMatch(async () => {
      const result: MatchState | undefined = await rematchViewRecordAction(formData);
      setPendingKey(null);

      if (result?.error) {
        setMatchError(result.error);
        return;
      }

      toast.success(result?.message ?? "已重新匹配");
      setOpen(false);
    });
  }

  const isTv = mediaType === "tv";
  const busy = matching;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 打开时把季号拉回这条流水当前的值，丢掉上次没提交的选择
        if (next) setSeason(progressSeason != null ? String(progressSeason) : "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="重新匹配">
          <SearchCheck />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>重新匹配这条记录</DialogTitle>
          <DialogDescription>
            搜片名或直接填 TMDB ID，点选正确的那一条，这条观影流水就改挂过去。
            当前作品与它的其它流水都不受影响。
          </DialogDescription>
        </DialogHeader>

        {isTv ? (
          <div className="space-y-2">
            <Label htmlFor="rematch-season">归属季</Label>
            <Input
              id="rematch-season"
              type="number"
              min={1}
              inputMode="numeric"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="留空表示未标记"
              className="h-8"
            />
            <p className="text-xs text-muted-foreground">
              按新条目的季号填，留空或指到电影都会被忽略。它会记入「已手动修改」，
              后续同步不再改动它。
            </p>
          </div>
        ) : null}

        <form action={searchAction} className="space-y-2">
          <Label htmlFor="rematch-query">片名或 TMDB ID</Label>
          <div className="flex items-center gap-2">
            <Input
              id="rematch-query"
              name="query"
              defaultValue={workTitle}
              placeholder="例如：喜宴，或 10862"
              className="h-8"
              autoComplete="off"
            />
            <Button type="submit" size="sm" disabled={searching || busy}>
              <Search />
              {searching ? "查询中…" : "查询"}
            </Button>
          </div>
        </form>

        {state?.error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        {matchError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {matchError}
          </p>
        ) : null}

        {state?.candidates?.length ? (
          <ul className="space-y-1.5">
            {state.candidates.map((c) => {
              const key = `${c.mediaType}:${c.tmdbId}`;
              const isPending = pendingKey === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => choose(c)}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
                      {c.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.poster}
                          alt={`${c.title} 海报`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-normal">
                          {mediaTypeLabel(c.mediaType)}
                        </Badge>
                        {c.year ? (
                          <span className="text-xs text-muted-foreground">{c.year}</span>
                        ) : null}
                        <span className="text-xs text-muted-foreground/70">
                          TMDB {c.tmdbId}
                        </span>
                      </div>
                      {c.originalTitle && c.originalTitle !== c.title ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {c.originalTitle}
                        </p>
                      ) : null}
                    </div>

                    <span className="shrink-0 text-xs text-muted-foreground">
                      {isPending ? "处理中…" : "选它"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
