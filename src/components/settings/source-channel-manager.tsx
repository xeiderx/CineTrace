"use client";

import { useActionState, useId, useState } from "react";
import { CornerDownRight, Layers, Pencil, Plus } from "lucide-react";
import {
  deleteSourceChannelAction,
  saveSourceChannelAction,
  type FormState,
} from "@/app/actions/library";
import { ConfirmDeleteButton } from "@/components/library/confirm-delete-button";
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
import type { SourceChannel } from "@/db/schema";
import type { SourceChannelNode } from "@/lib/queries";

/** 原生取色器只认 #rrggbb，库里存着别的写法时先回落到中性色，避免显示成纯黑 */
const COLOR_INPUT_FALLBACK = "#5b9bd5";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 渠道图标：有图显示图，没图按层级显示不同的占位图标 */
function ChannelIcon({ item }: { item: SourceChannel }) {
  if (item.iconData) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.iconData}
        alt=""
        className="size-8 shrink-0 rounded-lg bg-muted object-contain ring-1 ring-foreground/10"
      />
    );
  }

  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
      style={item.color ? { color: item.color } : undefined}
    >
      {item.parentId == null ? (
        <Layers className="size-4" />
      ) : (
        <CornerDownRight className="size-4" />
      )}
    </span>
  );
}

/**
 * 新建 / 编辑来源渠道。
 *
 * 层级不在表单里选：新建时由 `parent` 决定（有则二级、无则一级），
 * 编辑时忽略层级，只能改名称 / 图片 / 标识色 / 排序。
 */
function SourceChannelFormDialog({
  item,
  parent,
  libraries,
}: {
  item?: SourceChannel;
  parent?: SourceChannel;
  libraries: IconLibraryOption[];
}) {
  const isEdit = Boolean(item);
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(item?.color ?? "");
  const fieldId = useId();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveSourceChannelAction,
    undefined,
  );

  // 保存成功后关闭弹窗。用渲染期比对代替 effect，避免级联渲染。
  const [closedBy, setClosedBy] = useState<FormState>(undefined);
  if (state !== closedBy) {
    setClosedBy(state);
    if (state?.ok) setOpen(false);
  }

  const title = isEdit
    ? "编辑来源渠道"
    : parent
      ? `在「${parent.name}」下新增二级分类`
      : "新增一级分类";
  const description = isEdit
    ? "层级一旦创建就固定下来，这里只能改名称、图片、标识色与排序。"
    : parent
      ? "二级分类是具体的片源站点，比如彩虹岛、天空。"
      : "一级分类是渠道大类，比如流媒体、PT站点、EMBY服。";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label={`编辑渠道 ${item!.name}`}>
            <Pencil />
          </Button>
        ) : parent ? (
          <Button variant="ghost" size="xs">
            <Plus />
            新增二级
          </Button>
        ) : (
          <Button size="sm">
            <Plus />
            新增一级分类
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={item!.id} /> : null}
          {parent ? <input type="hidden" name="parentId" value={parent.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-name`}>名称 *</Label>
            <Input
              id={`${fieldId}-name`}
              name="name"
              defaultValue={item?.name ?? ""}
              placeholder={parent ? "如：B站" : "如：PT站点"}
              required
              autoFocus
            />
          </div>

          <IconField
            name="iconData"
            initial={item?.iconData ?? null}
            label="图标图片"
            libraries={libraries}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-color`}>标识色</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${fieldId}-color`}
                  type="color"
                  aria-label="自由取色"
                  value={HEX_COLOR.test(color) ? color : COLOR_INPUT_FALLBACK}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-8 w-14 shrink-0 p-1"
                />
                <span className="truncate text-xs text-muted-foreground">
                  {color || "未设颜色"}
                </span>
                {color ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="ml-auto"
                    onClick={() => setColor("")}
                  >
                    清除
                  </Button>
                ) : null}
              </div>
              <input type="hidden" name="color" value={color} />
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

/** 二级分类行 */
function ChildRow({
  item,
  usage,
  libraries,
}: {
  item: SourceChannel;
  usage: Record<number, number>;
  libraries: IconLibraryOption[];
}) {
  const count = usage[item.id] ?? 0;

  return (
    <li className="flex items-center gap-3 py-2.5 pl-10 pr-4">
      <ChannelIcon item={item} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {count > 0 ? `${count} 条记录在使用` : "暂无记录使用"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <SourceChannelFormDialog item={item} libraries={libraries} />
        <ConfirmDeleteButton
          action={deleteSourceChannelAction}
          id={item.id}
          title={`删除二级分类「${item.name}」？`}
          description={
            count > 0
              ? `有 ${count} 条观影记录在用这个渠道，删除后它们会回落为「未指定」。`
              : "该渠道没有被任何记录使用，可以安全删除。"
          }
        />
      </div>
    </li>
  );
}

/** 来源渠道管理：一级分组 + 组内二级列表 */
export function SourceChannelManager({
  channels,
  usage,
  libraries,
}: {
  channels: SourceChannelNode[];
  usage: Record<number, number>;
  libraries: IconLibraryOption[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">来源渠道</h2>
          <p className="text-xs text-muted-foreground">
            记录片源从哪来，分两级：一级是渠道大类，二级是具体站点或服务。
          </p>
        </div>
        <SourceChannelFormDialog libraries={libraries} />
      </div>

      {channels.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
          还没有来源渠道，先新增一个一级分类。
        </p>
      ) : (
        <ul className="space-y-3">
          {channels.map((node) => {
            const childTotal = node.children.reduce(
              (sum, child) => sum + (usage[child.id] ?? 0),
              0,
            );
            const totalCount = (usage[node.id] ?? 0) + childTotal;

            return (
              <li
                key={node.id}
                className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
              >
                <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                  <ChannelIcon item={node} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{node.name}</p>
                    <p className="text-xs text-muted-foreground">
                      本类 {usage[node.id] ?? 0} 条
                      {node.children.length > 0
                        ? ` · 二级 ${node.children.length} 个，共 ${childTotal} 条`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <SourceChannelFormDialog parent={node} libraries={libraries} />
                    <SourceChannelFormDialog item={node} libraries={libraries} />
                    <ConfirmDeleteButton
                      action={deleteSourceChannelAction}
                      id={node.id}
                      title={`删除一级分类「${node.name}」？`}
                      description={
                        node.children.length > 0
                          ? `其下的 ${node.children.length} 个二级分类会一并删除。${
                              totalCount > 0
                                ? `有 ${totalCount} 条观影记录在用这些渠道，删除后会回落为「未指定」。`
                                : "目前没有记录使用这些渠道。"
                            }`
                          : totalCount > 0
                            ? `有 ${totalCount} 条观影记录在用这个渠道，删除后会回落为「未指定」。`
                            : "该渠道没有被任何记录使用，可以安全删除。"
                      }
                    />
                  </div>
                </div>

                {node.children.length === 0 ? (
                  <p className="px-4 py-2.5 pl-10 text-xs text-muted-foreground">
                    还没有二级分类，点上方「新增二级」添加。
                  </p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {node.children.map((child) => (
                      <ChildRow key={child.id} item={child} usage={usage} libraries={libraries} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
