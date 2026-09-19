"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import {
  createViewRecordAction,
  updateViewRecordAction,
  type FormState,
} from "@/app/actions/library";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VIEW_STATUS_LABELS, VIEW_STATUS_ORDER } from "@/lib/labels";
import type { Platform, ViewRecord } from "@/db/schema";

/** 平台下拉的哨兵值：Radix Select 不接受空字符串作为 value */
const USE_DEFAULT = "__default__";
/** 季下拉的「未标记」哨兵值，parseInt 解析不出来，action 会落成 null */
const NO_SEASON = "__none__";

/**
 * 新增 / 编辑一条观影流水。
 * 同一部作品再次观看就新增一条，刷次自动递增，即二刷三刷。
 */
export function ViewRecordDialog({
  workId,
  mediaType,
  platforms,
  defaultPlatformName,
  seasons,
  record,
}: {
  workId: number;
  mediaType: string;
  platforms: Platform[];
  defaultPlatformName: string | null;
  /** 该剧 TMDB 的季列表；为空时季号只能手填 */
  seasons: { seasonNumber: number; name: string }[];
  record?: ViewRecord;
}) {
  const isEdit = Boolean(record);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    isEdit ? updateViewRecordAction : createViewRecordAction,
    undefined,
  );

  // 保存成功后关闭弹窗。用渲染期比对代替 effect，避免级联渲染。
  const [closedBy, setClosedBy] = useState<FormState>(undefined);
  if (state !== closedBy) {
    setClosedBy(state);
    if (state?.ok) setOpen(false);
  }

  const isTv = mediaType === "tv";

  // 记录上已有的季号即便不在 TMDB 列表里也要保留，否则一保存就把它清掉了
  const seasonOptions = Array.from(
    new Set([
      ...seasons.map((s) => s.seasonNumber),
      ...(record?.progressSeason != null ? [record.progressSeason] : []),
    ]),
  ).sort((a, b) => a - b);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label="编辑记录">
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus />
            记一次观看
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `编辑第 ${record!.watchIndex} 刷记录` : "记录一次观看"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "修改这次观看的时间、评分与进度。"
              : "同一部作品反复观看，每次都新增一条，自动记为一刷、二刷……"}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="workId" value={workId} />
          {isEdit ? <input type="hidden" name="id" value={record!.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="status">状态</Label>
              <Select
                name="status"
                defaultValue={record?.status ?? "watched"}
              >
                <SelectTrigger id="status" className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIEW_STATUS_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {VIEW_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rating">评分（1–5 星）</Label>
              <Input
                id="rating"
                name="rating"
                type="number"
                min={1}
                max={5}
                defaultValue={record?.rating ?? ""}
                placeholder="可留空"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="watchedAt">标记日期</Label>
              <Input
                id="watchedAt"
                name="watchedAt"
                type="date"
                defaultValue={record?.watchedAt ?? ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="platformId">观影平台</Label>
              <Select
                name="platformId"
                defaultValue={
                  record?.platformId != null
                    ? String(record.platformId)
                    : USE_DEFAULT
                }
              >
                <SelectTrigger id="platformId" className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USE_DEFAULT}>
                    跟随默认{defaultPlatformName ? `（${defaultPlatformName}）` : ""}
                  </SelectItem>
                  {platforms.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                      {p.isDefault ? "（默认）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startedAt">开始观看</Label>
              <Input
                id="startedAt"
                name="startedAt"
                type="date"
                defaultValue={record?.startedAt ?? ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="finishedAt">看完日期</Label>
              <Input
                id="finishedAt"
                name="finishedAt"
                type="date"
                defaultValue={record?.finishedAt ?? ""}
              />
            </div>
          </div>

          {isTv ? (
            <fieldset className="space-y-4 rounded-lg border border-border/70 p-4">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                剧集进度
              </legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="progressSeason">看到第几季</Label>
                  {seasonOptions.length > 0 ? (
                    <Select
                      name="progressSeason"
                      defaultValue={
                        record?.progressSeason != null
                          ? String(record.progressSeason)
                          : NO_SEASON
                      }
                    >
                      <SelectTrigger id="progressSeason" className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SEASON}>未标记</SelectItem>
                        {seasonOptions.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            第 {n} 季
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="progressSeason"
                      name="progressSeason"
                      type="number"
                      min={0}
                      defaultValue={record?.progressSeason ?? ""}
                      placeholder="2"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="progressEpisode">第几集</Label>
                  <Input
                    id="progressEpisode"
                    name="progressEpisode"
                    type="number"
                    min={0}
                    defaultValue={record?.progressEpisode ?? ""}
                    placeholder="5"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="episodesWatched">累计已看</Label>
                  <Input
                    id="episodesWatched"
                    name="episodesWatched"
                    type="number"
                    min={0}
                    defaultValue={record?.episodesWatched ?? ""}
                    placeholder="12"
                  />
                </div>
              </div>
            </fieldset>
          ) : null}

          {isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="watchIndex">刷次</Label>
              <Input
                id="watchIndex"
                name="watchIndex"
                type="number"
                min={1}
                defaultValue={record!.watchIndex}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="comment">短评</Label>
            <Textarea
              id="comment"
              name="comment"
              rows={3}
              defaultValue={record?.comment ?? ""}
              placeholder="可选"
            />
          </div>

          {state?.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
