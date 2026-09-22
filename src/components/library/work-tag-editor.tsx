"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { attachTagAction, detachTagAction } from "@/app/actions/library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Tag } from "@/db/schema";
import { tagChipStyle } from "@/lib/labels";

/**
 * 观影流水的标签编辑：可从已有标签里挑，也可以直接输入新名字。
 *
 * 标签挂在「某一次观看」上，而不是作品上：同一部片一刷觉得「剧情不错」、
 * 二刷觉得「不好看」，两个判断属于不同的观看行为，各挂各的才不会在作品层面
 * 混成一堆互相矛盾的标签。因此本组件有两种工作模式：
 *
 * - 即时模式（传 `viewRecordId`）：这条流水已落库，挂/摘立刻提交，
 *   依赖 action 里的 revalidatePath 把新的标签集合回传下来，不在本地维护副本。
 * - 草稿模式（传 `draftNames` / `onDraftChange`）：这条流水还没落库（新建时
 *   还没有 id），把标签名攒在本地并渲染成隐藏域 `tagNames`，随主表单一次提交，
 *   由 createViewRecordAction 落库拿到 id 后补写关联。
 */
type WorkTagEditorProps = { allTags: Tag[] } & (
  | {
      /** 即时模式：标签挂到这条已存在的流水上 */
      viewRecordId: number;
      attached: Tag[];
    }
  | {
      /** 草稿模式：这条流水还没落库，先把标签名攒在表单里 */
      draftNames: string[];
      onDraftChange: (names: string[]) => void;
    }
);

export function WorkTagEditor(props: WorkTagEditorProps) {
  const { allTags } = props;
  // 两个分支的字段互斥，先摊平成局部变量，省得在回调里反复做类型收窄
  const viewRecordId = "viewRecordId" in props ? props.viewRecordId : null;
  const attached = "attached" in props ? props.attached : [];
  const draftNames = "draftNames" in props ? props.draftNames : null;
  const onDraftChange = "draftNames" in props ? props.onDraftChange : null;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  // 草稿模式下刚输入的标签还没进 tag 表，取不到颜色，退化成中性色
  const colorByName = new Map(allTags.map((t) => [t.name, t.color]));
  const chips =
    draftNames != null
      ? draftNames.map((n) => ({
          key: n,
          name: n,
          color: colorByName.get(n) ?? null,
        }))
      : attached.map((t) => ({ key: String(t.id), name: t.name, color: t.color }));

  const attachedNames = new Set(chips.map((chip) => chip.name));
  const available = allTags.filter((t) => !attachedNames.has(t.name));

  function attach(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setName("");
    setOpen(false);

    if (draftNames != null && onDraftChange) {
      // 重名直接忽略：标签名在 tag 表里有唯一索引，重复提交没有意义
      if (!draftNames.includes(trimmed)) onDraftChange([...draftNames, trimmed]);
      return;
    }
    if (viewRecordId == null) return;

    const formData = new FormData();
    formData.set("viewRecordId", String(viewRecordId));
    formData.set("name", trimmed);
    startTransition(() => void attachTagAction(formData));
  }

  function detach(chipName: string) {
    if (draftNames != null && onDraftChange) {
      onDraftChange(draftNames.filter((n) => n !== chipName));
      return;
    }
    // 标签名有唯一索引，按名字回查 id 是安全的
    const target = attached.find((t) => t.name === chipName);
    if (viewRecordId == null || !target) return;

    const formData = new FormData();
    formData.set("viewRecordId", String(viewRecordId));
    formData.set("tagId", String(target.id));
    startTransition(() => void detachTagAction(formData));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant="secondary"
          className="gap-1 pr-1 font-normal"
          style={tagChipStyle(chip.color)}
        >
          {chip.name}
          <button
            type="button"
            aria-label={`移除标签 ${chip.name}`}
            disabled={pending}
            onClick={() => detach(chip.name)}
            className="rounded-full opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {/* 草稿模式：标签名随主表单一起提交，落库后由 action 补写关联 */}
      {draftNames?.map((n) => (
        <input key={n} type="hidden" name="tagNames" value={n} />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* 该组件会嵌进弹窗的 form 里，必须显式 type="button" 以免误提交 */}
          <Button type="button" variant="outline" size="xs" className="rounded-4xl">
            <Plus />
            标签
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 space-y-2">
          {/* 不用 form 包输入框：本组件会被嵌进弹窗的 form 里，form 嵌套是非法结构。
              改用 Enter 键提交，交互一致。 */}
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              attach(name);
            }}
            placeholder="输入后回车新建"
            className="h-8"
            autoFocus
          />

          {available.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {available.slice(0, 12).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={pending}
                  onClick={() => attach(t.name)}
                  className="rounded-4xl bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  style={tagChipStyle(t.color)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              还没有其他标签，输入名称即可新建。
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
