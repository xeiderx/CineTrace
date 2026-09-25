"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Plus, Star } from "lucide-react";
import {
  deletePlatformAction,
  savePlatformAction,
  setDefaultPlatformAction,
  type FormState,
} from "@/app/actions/library";
import { ConfirmDeleteButton } from "@/components/library/confirm-delete-button";
import {
  PLATFORM_ICON_NAMES,
  PlatformIcon,
} from "@/components/library/platform-icon";
import {
  IconField,
  type IconLibraryOption,
} from "@/components/settings/icon-field";
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
import type { Platform } from "@/db/schema";

/** 新建 / 编辑观影平台。默认平台由列表里的星标切换，不在表单里选。 */
function PlatformFormDialog({
  item,
  libraries,
}: {
  item?: Platform;
  libraries: IconLibraryOption[];
}) {
  const isEdit = Boolean(item);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePlatformAction,
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
          <Button variant="ghost" size="icon-sm" aria-label="编辑平台">
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus />
            新增平台
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑观影平台" : "新增观影平台"}</DialogTitle>
          <DialogDescription>
            观影记录默认落在「默认平台」上，个别记录可以单独改成别的平台。
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={item!.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="name">名称 *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={item?.name ?? ""}
              placeholder="如：家庭影院"
              required
              autoFocus
            />
          </div>

          <IconField
            name="icon"
            initial={item?.icon ?? null}
            label="平台图标"
            hint="可选内置图标，也可以用上传的图片或从图标库选择，会自动压缩到 128px 后存入数据库。"
            libraries={libraries}
            namedIcons={PLATFORM_ICON_NAMES}
            renderValue={(value) => <PlatformIcon icon={value} />}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="color">标识色</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={item?.color ?? "#e0a458"}
                className="h-8 w-full p-1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sortOrder">排序值</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                defaultValue={item?.sortOrder ?? 0}
                placeholder="越小越靠前"
              />
            </div>
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

/** 设为默认平台。单字段提交，直接用 transition 调用 action。 */
function SetDefaultButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="设为默认平台"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          const formData = new FormData();
          formData.set("id", String(id));
          void setDefaultPlatformAction(formData);
        })
      }
    >
      <Star />
    </Button>
  );
}

/** 观影平台管理：默认值 + 例外修改的基础设施 */
export function PlatformManager({
  platforms,
  usage,
  libraries,
}: {
  platforms: Platform[];
  usage: Record<number, number>;
  libraries: IconLibraryOption[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">观影平台</h2>
          <p className="text-xs text-muted-foreground">
            带星标的是默认平台，未单独指定平台的观影记录都归到它。
          </p>
        </div>
        <PlatformFormDialog libraries={libraries} />
      </div>

      {platforms.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
          还没有平台，先新增一个作为默认值。
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {platforms.map((item) => {
            const count = usage[item.id] ?? 0;
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
                  style={item.color ? { color: item.color } : undefined}
                >
                  <PlatformIcon icon={item.icon} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {item.name}
                    {item.isDefault ? (
                      <span className="inline-flex items-center gap-0.5 rounded-4xl bg-primary/15 px-1.5 py-0.5 text-xs font-normal text-primary">
                        <Star className="size-3 fill-current" />
                        默认
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {count > 0 ? `${count} 条记录在使用` : "暂无记录使用"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {item.isDefault ? null : <SetDefaultButton id={item.id} />}
                  <PlatformFormDialog item={item} libraries={libraries} />
                  <ConfirmDeleteButton
                    action={deletePlatformAction}
                    id={item.id}
                    title={`删除平台「${item.name}」？`}
                    description={
                      count > 0
                        ? `有 ${count} 条观影记录在用这个平台，删除后它们会回落到默认平台。`
                        : "该平台没有被任何记录使用，可以安全删除。"
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
