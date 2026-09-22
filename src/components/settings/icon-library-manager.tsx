"use client";

import { useActionState, useId, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  deleteIconLibraryAction,
  saveIconLibraryAction,
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
import type { IconLibrary } from "@/db/schema";

/** 新建 / 编辑图标库。只存名字与地址，图标在选的时候才按需拉取。 */
function IconLibraryFormDialog({ item }: { item?: IconLibrary }) {
  const isEdit = Boolean(item);
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveIconLibraryAction,
    undefined,
  );

  // 保存成功后关闭弹窗。用渲染期比对代替 effect，避免级联渲染。
  const [closedBy, setClosedBy] = useState<FormState>(undefined);
  if (state !== closedBy) {
    setClosedBy(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label={`编辑图标库 ${item!.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus />
            新增图标库
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑图标库" : "新增图标库"}</DialogTitle>
          <DialogDescription>
            图标库是一份公网 JSON，含 name、description 与 icons 列表（每项有 name 与 url）。
            服务端会走代理读取，因此不用保证本机能直连。
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={item!.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-name`}>名称 *</Label>
            <Input
              id={`${fieldId}-name`}
              name="name"
              defaultValue={item?.name ?? ""}
              placeholder="如：离歌Emby专用"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-url`}>地址 *</Label>
            <Input
              id={`${fieldId}-url`}
              name="url"
              type="url"
              defaultValue={item?.url ?? ""}
              placeholder="https://example.com/icons.json"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-sort`}>排序值</Label>
            <Input
              id={`${fieldId}-sort`}
              name="sortOrder"
              type="number"
              defaultValue={item?.sortOrder ?? 0}
              placeholder="越小越靠前"
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

/** 图标库管理：给平台与来源渠道挑图时用 */
export function IconLibraryManager({ libraries }: { libraries: IconLibrary[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">图标库</h2>
          <p className="text-xs text-muted-foreground">
            观影平台与来源渠道的图标除了自己上传，也可以从这些图标库里挑。
          </p>
        </div>
        <IconLibraryFormDialog />
      </div>

      {libraries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
          还没有图标库，先添加一个。
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {libraries.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="truncate text-xs text-muted-foreground">{item.url}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <IconLibraryFormDialog item={item} />
                <ConfirmDeleteButton
                  action={deleteIconLibraryAction}
                  id={item.id}
                  title={`删除图标库「${item.name}」？`}
                  description="已经选好并入库的图标不受影响，只是以后不能再从它这里选图。"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
