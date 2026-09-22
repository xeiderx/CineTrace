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
 * 作品标签编辑：可从已有标签里挑，也可以直接输入新名字。
 *
 * 详情页、编辑作品弹窗与观影记录弹窗共用这一套交互：挂/摘都即时提交，
 * 依赖 action 里的 revalidatePath 把新的标签集合回传下来，不在本地维护副本，
 * 免得三处各存一份状态后彼此对不上。
 */
export function WorkTagEditor({
  workId,
  attached,
  allTags,
}: {
  workId: number;
  attached: Tag[];
  allTags: Tag[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const attachedIds = new Set(attached.map((t) => t.id));
  const available = allTags.filter((t) => !attachedIds.has(t.id));

  function attach(value: string) {
    if (!value.trim()) return;
    const formData = new FormData();
    formData.set("workId", String(workId));
    formData.set("name", value.trim());
    setName("");
    setOpen(false);
    startTransition(() => void attachTagAction(formData));
  }

  function detach(tagId: number) {
    const formData = new FormData();
    formData.set("workId", String(workId));
    formData.set("tagId", String(tagId));
    startTransition(() => void detachTagAction(formData));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attached.map((t) => (
        <Badge
          key={t.id}
          variant="secondary"
          className="gap-1 pr-1 font-normal"
          style={tagChipStyle(t.color)}
        >
          {t.name}
          <button
            type="button"
            aria-label={`移除标签 ${t.name}`}
            disabled={pending}
            onClick={() => detach(t.id)}
            className="rounded-full opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* 该组件会嵌进编辑作品弹窗的 form 里，必须显式 type="button" 以免误提交 */}
          <Button type="button" variant="outline" size="xs" className="rounded-4xl">
            <Plus />
            标签
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 space-y-2">
          {/* 不用 form 包输入框：本组件会被嵌进编辑弹窗的 form 里，form 嵌套是非法结构。
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
