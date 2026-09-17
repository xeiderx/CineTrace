"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import {
  createTagAction,
  deleteTagAction,
  type FormState,
} from "@/app/actions/library";
import { ConfirmDeleteButton } from "@/components/library/confirm-delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tag } from "@/db/schema";

/**
 * 标签管理。标签可以在作品详情页随手新建，
 * 这里负责集中查看、补建与清理。
 */
export function TagManager({
  tags,
  usage,
}: {
  tags: Tag[];
  usage: Record<number, number>;
}) {
  const [name, setName] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTagAction,
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // 新建成功后清空输入框，便于连续录入。
  // 用渲染期比对代替 effect 里的 setState，避免级联渲染。
  const [clearedFor, setClearedFor] = useState<FormState>(undefined);
  if (state !== clearedFor) {
    setClearedFor(state);
    if (state?.ok) setName("");
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

      <form action={formAction} className="flex items-center gap-2">
        <Input
          ref={inputRef}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="新标签名称"
          className="h-8 max-w-56"
          required
        />
        <Button type="submit" size="sm" disabled={pending}>
          <Plus />
          {pending ? "添加中…" : "添加"}
        </Button>
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
              >
                <TagIcon className="size-3.5 text-muted-foreground" />
                <span>{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {count > 0 ? count : ""}
                </span>
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
