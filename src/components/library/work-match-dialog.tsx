"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Combine, Search, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import {
  matchWorkToTmdbAction,
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
 * 手动重新匹配 TMDB。
 *
 * 自动匹配失败或匹配错的作品，从这里搜片名（或直接填 TMDB ID）挑一个正确条目；
 * 选中后由服务端拉详情一次性回填海报、简介、时长与分季结构，
 * 不需要像「编辑信息」那样逐项填表。原编辑弹窗保留作兜底。
 */
export function WorkMatchDialog({
  workId,
  workTitle,
}: {
  workId: number;
  workTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, searchAction, searching] = useActionState<SearchState, FormData>(
    searchTmdbAction,
    undefined,
  );

  // 选中的候选项正在回填时的 ID，用来在列表里标出「处理中」
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [matching, startMatch] = useTransition();
  const [matchError, setMatchError] = useState<string | null>(null);
  // 目标 TMDB 条目已被别的作品占着：记下冲突方可一键合并
  const [conflict, setConflict] = useState<
    (MatchState["conflict"] & { candidate: TmdbCandidate }) | null
  >(null);
  const router = useRouter();

  function choose(candidate: TmdbCandidate, merge = false) {
    const key = `${candidate.mediaType}:${candidate.tmdbId}`;
    setMatchError(null);
    setPendingKey(key);

    const formData = new FormData();
    formData.set("id", String(workId));
    formData.set("tmdbId", String(candidate.tmdbId));
    formData.set("mediaType", candidate.mediaType);
    if (merge) formData.set("merge", "1");

    startMatch(async () => {
      const result = await matchWorkToTmdbAction(formData);
      setPendingKey(null);

      if (result?.error) {
        setMatchError(result.error);
        setConflict(result.conflict ? { ...result.conflict, candidate } : null);
        return;
      }

      setConflict(null);
      toast.success(result?.message ?? "已重新绑定");
      setOpen(false);
      // 作品被并进另一部后当前详情页已不存在，得跳到存留下来的那一部
      if (result?.merged) router.push(`/library/${result.merged.workId}`);
    });
  }

  const busy = matching;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SearchCheck />
          重新匹配
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>重新匹配 TMDB</DialogTitle>
          <DialogDescription>
            搜片名或直接填 TMDB ID，点选正确的那一条即可自动补齐海报与简介。
          </DialogDescription>
        </DialogHeader>

        <form action={searchAction} className="space-y-2">
          <Label htmlFor="tmdb-query">片名或 TMDB ID</Label>
          <div className="flex items-center gap-2">
            <Input
              id="tmdb-query"
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
          <div className="space-y-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p role="alert">{matchError}</p>
            {conflict ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  合并会把这一条的观影记录转到《{conflict.title}》，本条随后删除。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => choose(conflict.candidate, true)}
                >
                  <Combine />
                  {pendingKey ? "合并中…" : `合并到《${conflict.title}》`}
                </Button>
              </div>
            ) : null}
          </div>
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
                          <span className="text-xs text-muted-foreground">
                            {c.year}
                          </span>
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
                      {isPending ? "绑定中…" : "选它"}
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
