"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Tag as TagIcon } from "lucide-react";
import {
  createTagAction,
  deleteTagAction,
  updateTagAction,
  type FormState,
} from "@/app/actions/library";
import { ConfirmDeleteButton } from "@/components/library/confirm-delete-button";
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
import type { Tag } from "@/db/schema";
import { TAG_COLOR_PRESETS, tagChipStyle } from "@/lib/labels";

/** 原生取色器只认 #rrggbb，库里存着别的写法时先回落到色板首色，避免显示成纯黑 */
const COLOR_INPUT_FALLBACK = TAG_COLOR_PRESETS[0];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * 标签选色：预设色板点选，或直接用取色器自由取色。
 *
 * 颜色值同时放一份在 hidden 字段里，这样表单提交走的还是普通 FormData，
 * 不必为取色单开一个 action；`value` 为空串表示不设颜色。
 */
function TagColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {TAG_COLOR_PRESETS.map((preset) => {
          const selected = preset.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              aria-label={`使用颜色 ${preset}`}
              aria-pressed={selected}
              onClick={() => onChange(preset)}
              className={
                selected
                  ? "size-6 rounded-full ring-2 ring-foreground/60 ring-offset-2 ring-offset-background"
                  : "size-6 rounded-full ring-1 ring-foreground/15 transition-transform hover:scale-110"
              }
              style={{ backgroundColor: preset }}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label="自由取色"
          value={HEX_COLOR.test(value) ? value : COLOR_INPUT_FALLBACK}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-14 shrink-0 p-1"
        />
        <span className="text-xs text-muted-foreground">
          {value ? value : "未设颜色，使用中性样式"}
        </span>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => onChange("")}
          >
            清除
          </Button>
        ) : null}
      </div>

      <input type="hidden" name="color" value={value} />
    </div>
  );
}

/** 编辑标签：名称与颜色都能改 */
function TagEditDialog({ item }: { item: Tag }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState(item.color ?? "");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateTagAction,
    undefined,
  );

  // 在渲染期比对代替 effect 里的 setState：成功即关弹窗
  const [closedBy, setClosedBy] = useState<FormState>(undefined);
  if (state !== closedBy) {
    setClosedBy(state);
    if (state?.ok) setOpen(false);
  }

  // 每次打开都从最新的 props 重置，避免上次改到一半的输入残留
  function handleOpenChange(next: boolean) {
    if (next) {
      setName(item.name);
      setColor(item.color ?? "");
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`编辑标签 ${item.name}`}>
          <Pencil />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑标签</DialogTitle>
          <DialogDescription>
            改名只影响标签本身，已挂载的作品会跟着显示新名字。
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={item.id} />

          <div className="space-y-2">
            <Label htmlFor={`tag-name-${item.id}`}>名称 *</Label>
            <Input
              id={`tag-name-${item.id}`}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="标签名称"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>颜色</Label>
            <TagColorField value={color} onChange={setColor} />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">预览</span>
            <span
              className="rounded-4xl bg-muted px-2 py-0.5 text-xs font-medium"
              style={tagChipStyle(color)}
            >
              {name || "标签名"}
            </span>
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

/**
 * 标签管理。标签可以在作品详情页随手新建，
 * 这里负责集中查看、补建、配色与清理。
 */
export function TagManager({
  tags,
  usage,
}: {
  tags: Tag[];
  usage: Record<number, number>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTagAction,
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // 新建成功后清空表单，便于连续录入。
  // 用渲染期比对代替 effect 里的 setState，避免级联渲染。
  const [clearedFor, setClearedFor] = useState<FormState>(undefined);
  if (state !== clearedFor) {
    setClearedFor(state);
    if (state?.ok) {
      setName("");
      setColor("");
    }
  }

  // 清空后把焦点放回输入框
  useEffect(() => {
    if (state?.ok) inputRef.current?.focus();
  }, [state]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-medium">标签</h2>
        <p className="text-xs text-muted-foreground">
          给作品打自定义标签，如「陪家人看」「想看第二遍」。作品详情页可直接挂载。
        </p>
      </div>

      <form
        action={formAction}
        className="space-y-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={inputRef}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="新标签名称"
            className="h-8 max-w-56"
            required
          />
          <span
            className="rounded-4xl bg-muted px-2 py-0.5 text-xs font-medium"
            style={tagChipStyle(color)}
          >
            {name || "标签名"}
          </span>
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            disabled={pending}
          >
            <Plus />
            {pending ? "添加中…" : "添加"}
          </Button>
        </div>

        <TagColorField value={color} onChange={setColor} />
      </form>

      {state?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      {tags.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
          还没有标签。
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((item) => {
            const count = usage[item.id] ?? 0;
            return (
              <li
                key={item.id}
                className="flex items-center gap-1.5 rounded-4xl bg-muted py-1 pl-3 pr-1 text-sm"
                style={tagChipStyle(item.color)}
              >
                <TagIcon className="size-3.5 opacity-70" />
                <span>{item.name}</span>
                <span className="text-xs opacity-70">
                  {count > 0 ? count : ""}
                </span>
                <TagEditDialog item={item} />
                <ConfirmDeleteButton
                  action={deleteTagAction}
                  id={item.id}
                  title={`删除标签「${item.name}」？`}
                  description={
                    count > 0
                      ? `有 ${count} 部作品挂着这个标签，删除后标签会从作品上移除，作品本身不受影响。`
                      : "该标签还没有被使用，可以安全删除。"
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
