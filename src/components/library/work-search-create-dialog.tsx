"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  createWorkFromTmdbAction,
  searchTmdbAction,
  type SearchState,
  type TmdbCandidate,
} from "@/app/actions/library";
import { WorkFormDialog } from "@/components/library/work-form-dialog";
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
 * 手动添加作品。搜片名或直接填 TMDB ID，点选正确的那一条，
 * 海报、简介、时长、分季、国家、主演由服务端一次性回填，不必逐项填表。
 * TMDB 也没有的冷门片，走底部的详细表单兜底录入。
 */
export function WorkSearchCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [state, searchAction, searching] = useActionState<SearchState, FormData>(
    searchTmdbAction,
    undefined,
  );

  // 选中的候选项正在创建时的 ID，用来在列表里标出「处理中」
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  function choose(candidate: TmdbCandidate) {
    const key = `${candidate.mediaType}:${candidate.tmdbId}`;
    setCreateError(null);
    setPendingKey(key);

    const formData = new FormData();
    formData.set("tmdbId", String(candidate.tmdbId));
    formData.set("mediaType", candidate.mediaType);
    formData.set("title", candidate.title);

    startCreate(async () => {
      const result = await createWorkFromTmdbAction(formData);
      setPendingKey(null);

      if (result?.error) {
        setCreateError(result.error);
        return;
      }
      toast.success(result?.message ?? "已添加");
      setOpen(false);
      if (result?.workId != null) router.push(`/library/${result.workId}`);
    });
  }

  const busy = creating;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus />
            手动添加
          </Button>
        </DialogTrigger>

        <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>手动添加作品</DialogTitle>
            <DialogDescription>
              搜片名或直接填 TMDB ID，点选正确的那一条即可自动补齐海报与简介。
            </DialogDescription>
          </DialogHeader>

          <form action={searchAction} className="space-y-2">
            <Label htmlFor="tmdb-create-query">片名或 TMDB ID</Label>
            <div className="flex items-center gap-2">
              <Input
                id="tmdb-create-query"
                name="query"
                placeholder="例如：喜宴，或 10862"
                className="h-8"
                autoComplete="off"
                autoFocus
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

          {createError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {createError}
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
                        {isPending ? "添加中…" : "添加"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setManualOpen(true);
              }}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              TMDB 也搜不到？手工填写条目信息
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <WorkFormDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        showTrigger={false}
      />
    </>
  );
}
