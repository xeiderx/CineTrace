"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import {
  createWorkAction,
  updateWorkAction,
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
import { WorkTagEditor } from "@/components/library/work-tag-editor";
import { MEDIA_TYPE_LABELS, parseCast } from "@/lib/labels";
import type { Tag, Work } from "@/db/schema";

/** 把 JSON 数组列还原成逗号分隔文本，供表单编辑 */
function joinList(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join("、") : "";
  } catch {
    return "";
  }
}

/** 主演列是对象数组，表单里只编辑姓名，这里只取 name */
function joinCast(value: string | null | undefined): string {
  return parseCast(value)
    .map((c) => c.name)
    .join("、");
}

/**
 * 作品录入 / 编辑表单。手动新建用于豆瓣没有、或自动匹配失败的条目；
 * 编辑用于修正匹配错误后替换成正确的元数据。
 *
 * 默认自带触发按钮；传入 open / onOpenChange 可改为受控，
 * 供搜索式新建弹窗的「TMDB 也搜不到」兜底入口复用。
 */
export function WorkFormDialog({
  work,
  tags,
  allTags,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  work?: Work;
  /** 作品当前已挂的标签，仅编辑模式需要 */
  tags?: Tag[];
  /** 全部标签，供选择区挑选 */
  allTags?: Tag[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const isEdit = Boolean(work);
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;

  function setOpen(next: boolean) {
    if (!controlled) setInnerOpen(next);
    onOpenChange?.(next);
  }

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    isEdit ? updateWorkAction : createWorkAction,
    undefined,
  );

  // 编辑保存成功后自动关闭；新建时由 action 内部重定向到详情页。
  // 用渲染期比对代替 effect，避免级联渲染。
  const [closedBy, setClosedBy] = useState<FormState>(undefined);
  if (state !== closedBy) {
    setClosedBy(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger asChild>
          {isEdit ? (
            <Button variant="outline" size="sm">
              <Pencil />
              编辑信息
            </Button>
          ) : (
            <Button size="sm">
              <Plus />
              手动添加
            </Button>
          )}
        </DialogTrigger>
      ) : null}

      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑作品信息" : "手动添加作品"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "匹配有误时，可直接改为正确的片名与编号，或留空让后续同步重新匹配。"
              : "豆瓣抓取不到的条目可以在这里直接录入，之后可随时补充元数据。"}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={work!.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title">片名 *</Label>
              <Input
                id="title"
                name="title"
                defaultValue={work?.title ?? ""}
                placeholder="中文片名"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mediaType">类型</Label>
              <Select name="mediaType" defaultValue={work?.mediaType ?? "movie"}>
                <SelectTrigger id="mediaType" className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MEDIA_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="year">年份</Label>
              <Input
                id="year"
                name="year"
                type="number"
                min={1888}
                max={2200}
                defaultValue={work?.year ?? ""}
                placeholder="2024"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="originalTitle">原始片名</Label>
              <Input
                id="originalTitle"
                name="originalTitle"
                defaultValue={work?.originalTitle ?? ""}
                placeholder="用于匹配的外文名"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="runtime">
                {work?.mediaType === "tv" ? "单集时长（分钟）" : "片长（分钟）"}
              </Label>
              <Input
                id="runtime"
                name="runtime"
                type="number"
                min={1}
                defaultValue={work?.runtime ?? ""}
                placeholder="120"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="releaseDate">上映 / 首播日期</Label>
              <Input
                id="releaseDate"
                name="releaseDate"
                type="date"
                defaultValue={work?.releaseDate ?? ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seasonCount">总季数（剧集）</Label>
              <Input
                id="seasonCount"
                name="seasonCount"
                type="number"
                min={1}
                defaultValue={work?.seasonCount ?? ""}
                placeholder="3"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="episodeCount">总集数（剧集）</Label>
              <Input
                id="episodeCount"
                name="episodeCount"
                type="number"
                min={1}
                defaultValue={work?.episodeCount ?? ""}
                placeholder="36"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tmdbId">TMDB ID</Label>
              <Input
                id="tmdbId"
                name="tmdbId"
                type="number"
                defaultValue={work?.tmdbId ?? ""}
                placeholder="留空待匹配"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doubanId">豆瓣 ID</Label>
              <Input
                id="doubanId"
                name="doubanId"
                defaultValue={work?.doubanId ?? ""}
                placeholder="1292052"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="posterPath">海报地址</Label>
              <Input
                id="posterPath"
                name="posterPath"
                defaultValue={work?.posterPath ?? ""}
                placeholder="TMDB 路径或完整外链"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="genres">类型标签</Label>
              <Input
                id="genres"
                name="genres"
                defaultValue={joinList(work?.genres)}
                placeholder="剧情、犯罪（用逗号或顿号分隔）"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="countries">制片国家</Label>
              <Input
                id="countries"
                name="countries"
                defaultValue={joinList(work?.countries)}
                placeholder="中国大陆、美国（用逗号或顿号分隔）"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="directors">导演</Label>
              <Input
                id="directors"
                name="directors"
                defaultValue={joinList(work?.directors)}
                placeholder="克里斯托弗·诺兰"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cast">主演</Label>
              <Input
                id="cast"
                name="cast"
                defaultValue={joinCast(work?.cast)}
                placeholder="用逗号或顿号分隔"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="overview">简介</Label>
              <Textarea
                id="overview"
                name="overview"
                rows={3}
                defaultValue={work?.overview ?? ""}
                placeholder="剧情简介"
              />
            </div>

            {/* 标签挂在作品上，与本次表单提交无关（即时生效），因此不动 updateWorkAction。
                新建作品时还没有 workId，无法挂标签，只在编辑模式出现。 */}
            {isEdit && work && allTags ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>标签</Label>
                <WorkTagEditor
                  workId={work.id}
                  attached={tags ?? []}
                  allTags={allTags}
                />
              </div>
            ) : null}
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
              {pending ? "保存中…" : isEdit ? "保存" : "创建并查看"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
