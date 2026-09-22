"use client";

import { useActionState, useState } from "react";
import { CheckIcon, ChevronDownIcon, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  createViewRecordAction,
  unlockViewRecordFieldsAction,
  updateViewRecordAction,
  type FormState,
} from "@/app/actions/library";
import { ChannelIcon, findChannel } from "@/components/library/channel-icon";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  VIEW_STATUS_LABELS,
  VIEW_STATUS_ORDER,
  viewRecordFieldLabel,
} from "@/lib/labels";
import { parseManualFields } from "@/lib/watch-progress";
import { WorkTagEditor } from "@/components/library/work-tag-editor";
import type { Platform, Tag, ViewRecord } from "@/db/schema";
import type { SourceChannelNode } from "@/lib/queries";

/** 平台下拉的哨兵值：Radix Select 不接受空字符串作为 value */
const USE_DEFAULT = "__default__";
/** 季下拉的「未标记」哨兵值，parseInt 解析不出来，action 会落成 null */
const NO_SEASON = "__none__";
/** 来源渠道下拉的「未指定」哨兵值，同上由 action 落成 null */
const NO_CHANNEL = "__no_channel__";

/**
 * 新增 / 编辑一条观影流水。
 * 同一部作品再次观看就新增一条，刷次自动递增，即二刷三刷。
 *
 * 标签挂在这条流水上：编辑时改的是本条记录自己的标签（即时生效），
 * 新建时本条还没落库，只能先把标签名攒在草稿里随主表单一起提交。
 */
export function ViewRecordDialog({
  workId,
  mediaType,
  platforms,
  defaultPlatformName,
  seasons,
  record,
  allTags,
  sourceChannels,
}: {
  workId: number;
  mediaType: string;
  platforms: Platform[];
  defaultPlatformName: string | null;
  /** 该剧 TMDB 的季列表；为空时季号只能手填。`episodeCount` 用于卡住手填集数的上限 */
  seasons: { seasonNumber: number; name: string; episodeCount?: number }[];
  /** 编辑时传入这条流水。标签随流水一起取，由调用方从 `record.tags` 带过来 */
  record?: ViewRecord & { tags?: Tag[] };
  /** 全部标签，供选择区挑选；不传则不显示标签区 */
  allTags?: Tag[];
  /** 来源渠道两级树，供片源下拉分组展示；不传则不显示该字段 */
  sourceChannels?: SourceChannelNode[];
}) {
  const isEdit = Boolean(record);
  const [open, setOpen] = useState(false);
  // 新建时这条流水还没有 id，标签只能先攒在本地，随主表单以 tagNames 提交
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    isEdit ? updateViewRecordAction : createViewRecordAction,
    undefined,
  );

  // 季号要跟着用户的选择走，才知道该用哪一季的集数去卡上限，
  // 所以这里是受控的（Radix Select 的 value 仍会随表单一起提交）。
  const [progressSeason, setProgressSeason] = useState<number | null>(
    record?.progressSeason ?? null,
  );
  const seasonCap =
    seasons.find((s) => s.seasonNumber === progressSeason)?.episodeCount ?? null;

  // 渠道下拉换成了 DropdownMenu，不再由 Radix Select 直接参与表单，改由本地状态
  // 驱动隐藏字段提交，因此这里是受控的
  const [channelValue, setChannelValue] = useState(
    record?.sourceChannelId != null ? String(record.sourceChannelId) : NO_CHANNEL,
  );
  const channelId = channelValue === NO_CHANNEL ? null : Number.parseInt(channelValue, 10);
  const selectedChannel =
    channelId != null && Number.isFinite(channelId)
      ? findChannel(sourceChannels ?? [], channelId)
      : null;
  const channelLabel = selectedChannel
    ? selectedChannel.parentName
      ? `${selectedChannel.parentName} › ${selectedChannel.channel.name}`
      : selectedChannel.channel.name
    : "未指定";

  // 被手动锁定、同步不会覆盖的字段（库里存字段名，这里换成中文展示）
  const lockedFields = parseManualFields(record?.manualFieldsJson);
  // 勾选后要恢复跟随豆瓣的字段，与「恢复」按钮的提交内容
  const [unlockFields, setUnlockFields] = useState<string[]>([]);
  const [unlockState, unlockAction, unlocking] = useActionState<FormState, FormData>(
    unlockViewRecordFieldsAction,
    undefined,
  );

  // 恢复成功后清掉勾选并提示，效果与「保存」的轻提示保持一致
  const [unlockedBy, setUnlockedBy] = useState<FormState>(undefined);
  if (unlockState !== unlockedBy) {
    setUnlockedBy(unlockState);
    if (unlockState?.ok) {
      setUnlockFields([]);
      toast.success(unlockState.message ?? "已恢复跟随豆瓣");
    } else if (unlockState?.error) {
      toast.error(unlockState.error);
    }
  }

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 打开时把受控字段拉回记录上的值，丢掉上次没保存的草稿
        if (next) {
          setProgressSeason(record?.progressSeason ?? null);
          setChannelValue(
            record?.sourceChannelId != null
              ? String(record.sourceChannelId)
              : NO_CHANNEL,
          );
          setUnlockFields([]);
          setDraftTags([]);
        }
      }}
    >
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
              <Label htmlFor="sourceChannelId">来源渠道</Label>
              {/* 渠道是两级的，平铺会把下拉撑得很长，因此一级先列出来、二级收进子菜单；
                  选中结果通过隐藏字段随主表单一起提交（DropdownMenu 不参与表单） */}
              <input
                type="hidden"
                name="sourceChannelId"
                value={channelValue}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  id="sourceChannelId"
                  className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {selectedChannel ? (
                      <ChannelIcon
                        icon={selectedChannel.channel.iconData}
                        color={selectedChannel.channel.color}
                      />
                    ) : null}
                    <span className="truncate">{channelLabel}</span>
                  </span>
                  <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem onSelect={() => setChannelValue(NO_CHANNEL)}>
                    <span className="text-muted-foreground">未指定</span>
                    {channelValue === NO_CHANNEL ? (
                      <CheckIcon className="ml-auto size-4 text-muted-foreground" />
                    ) : null}
                  </DropdownMenuItem>

                  {sourceChannels && sourceChannels.length > 0 ? (
                    <DropdownMenuSeparator />
                  ) : null}

                  {sourceChannels?.map((node) =>
                    // 一级分类本身也能选，所以子菜单里先放它自己，再列二级
                    node.children.length > 0 ? (
                      <DropdownMenuSub key={node.id}>
                        <DropdownMenuSubTrigger>
                          <ChannelIcon icon={node.iconData} color={node.color} />
                          <span className="truncate">{node.name}</span>
                          {channelValue === String(node.id) ? (
                            <CheckIcon className="size-4" />
                          ) : null}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-48">
                          <DropdownMenuItem
                            onSelect={() => setChannelValue(String(node.id))}
                          >
                            <ChannelIcon icon={node.iconData} color={node.color} />
                            <span>整个大类</span>
                            {channelValue === String(node.id) ? (
                              <CheckIcon className="ml-auto size-4" />
                            ) : null}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {node.children.map((child) => (
                            <DropdownMenuItem
                              key={child.id}
                              onSelect={() => setChannelValue(String(child.id))}
                            >
                              <ChannelIcon icon={child.iconData} color={child.color} />
                              <span className="truncate">{child.name}</span>
                              {channelValue === String(child.id) ? (
                                <CheckIcon className="ml-auto size-4" />
                              ) : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ) : (
                      <DropdownMenuItem
                        key={node.id}
                        onSelect={() => setChannelValue(String(node.id))}
                      >
                        <ChannelIcon icon={node.iconData} color={node.color} />
                        <span className="truncate">{node.name}</span>
                        {channelValue === String(node.id) ? (
                          <CheckIcon className="ml-auto size-4" />
                        ) : null}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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
                      value={progressSeason == null ? NO_SEASON : String(progressSeason)}
                      onValueChange={(value) =>
                        setProgressSeason(
                          value === NO_SEASON ? null : Number.parseInt(value, 10),
                        )
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
                      value={progressSeason ?? ""}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        setProgressSeason(Number.isFinite(parsed) ? parsed : null);
                      }}
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
                    max={seasonCap ?? undefined}
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
                    max={seasonCap ?? undefined}
                    defaultValue={record?.episodesWatched ?? ""}
                    placeholder="12"
                  />
                </div>
              </div>
              {seasonCap != null ? (
                <p className="text-xs text-muted-foreground">
                  第 {progressSeason} 季共 {seasonCap} 集
                </p>
              ) : null}
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

          {/* 标签挂在这条流水上。编辑时本条已落库，挂/摘即时生效，放在这里只是就近摆放，
              不参与本次提交；新建时本条还没有 id，标签名随主表单一起提交。 */}
          {allTags ? (
            <div className="space-y-2">
              <Label>标签</Label>
              {isEdit && record ? (
                <WorkTagEditor
                  viewRecordId={record.id}
                  attached={record.tags ?? []}
                  allTags={allTags}
                />
              ) : (
                <WorkTagEditor
                  draftNames={draftTags}
                  onDraftChange={setDraftTags}
                  allTags={allTags}
                />
              )}
            </div>
          ) : null}

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

        {/* 单独一个表单：解锁只动锁定名单，不该顺带把没保存的编辑也提交上去 */}
        {isEdit && lockedFields.length > 0 ? (
          <form
            action={unlockAction}
            className="space-y-3 rounded-lg border border-border/70 p-4"
          >
            <input type="hidden" name="id" value={record!.id} />

            <div className="space-y-1">
              <p className="text-sm font-medium">已手动修改的字段</p>
              <p className="text-xs text-muted-foreground">
                这些字段你自己改过，豆瓣同步不会覆盖它们。勾选后可恢复跟随豆瓣，
                下次同步会写回豆瓣的值。
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {lockedFields.map((field) => (
                <label
                  key={field}
                  className="flex items-center gap-2 text-sm text-foreground/90"
                >
                  <input
                    type="checkbox"
                    name="fields"
                    value={field}
                    checked={unlockFields.includes(field)}
                    onChange={(event) =>
                      setUnlockFields((prev) =>
                        event.target.checked
                          ? [...prev, field]
                          : prev.filter((name) => name !== field),
                      )
                    }
                    className="size-4 shrink-0 rounded border-input accent-primary"
                  />
                  {viewRecordFieldLabel(field)}
                </label>
              ))}
            </div>

            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={unlocking || unlockFields.length === 0}
            >
              {unlocking ? "恢复中…" : "恢复跟随豆瓣"}
            </Button>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
