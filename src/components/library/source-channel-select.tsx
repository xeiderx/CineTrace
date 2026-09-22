"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { updateRecordSourceChannelAction } from "@/app/actions/library";
import { ChannelIcon, findChannel } from "@/components/library/channel-icon";
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
import { cn } from "@/lib/utils";
import type { SourceChannelNode } from "@/lib/queries";

/** 与观影记录弹窗同一约定：「未指定」用哨兵值，action 里 parseInt 解析不出会落成 null */
const NO_CHANNEL = "__no_channel__";

function toValue(id: number | null | undefined): string {
  return id == null ? NO_CHANNEL : String(id);
}

/**
 * 内嵌的来源渠道选择器，直接挂在页面上用。
 *
 * 渠道与标签一样属于「某一次观看」，不属于作品：没有现成的流水时无处可挂，
 * 调用方应先判断有没有流水，再决定渲染本组件还是提示去记一次观看。
 *
 * 选中后折叠成纯图标，点图标再展开修改；选中即提交，只改这一条流水的来源渠道
 * （走 updateRecordSourceChannelAction，不碰状态、日期等其它字段），随后由 action
 * 里的 revalidatePath 把新值回传下来。
 */
export function SourceChannelSelect({
  viewRecordId,
  current,
  sourceChannels,
  className,
}: {
  /** 来源渠道要落到哪条流水上 */
  viewRecordId: number;
  /** 这条流水当前的来源渠道 id，未指定为 null */
  current: number | null;
  /** 来源渠道两级树 */
  sourceChannels: SourceChannelNode[];
  className?: string;
}) {
  const [value, setValue] = useState(toValue(current));
  const [pending, startTransition] = useTransition();

  // 别处（观影记录弹窗）改了同一条流水时，这里要跟着变。
  // 用渲染期比对代替 effect，避免多渲染一轮；只在服务端值真的变了时才覆盖
  // 本地值，否则用户在等待刷新的这段时间里选的会被打回去。
  const serverValue = toValue(current);
  const [syncedValue, setSyncedValue] = useState(serverValue);
  if (serverValue !== syncedValue) {
    setSyncedValue(serverValue);
    setValue(serverValue);
  }

  function change(next: string) {
    setValue(next);

    const formData = new FormData();
    formData.set("viewRecordId", String(viewRecordId));
    formData.set("sourceChannelId", next);
    startTransition(() => void updateRecordSourceChannelAction(formData));
  }

  const selectedId = value === NO_CHANNEL ? null : Number.parseInt(value, 10);
  const selected =
    selectedId != null && Number.isFinite(selectedId)
      ? findChannel(sourceChannels, selectedId)
      : null;
  const selectedLabel = selected
    ? selected.parentName
      ? `${selected.parentName} › ${selected.channel.name}`
      : selected.channel.name
    : "未指定来源渠道";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="来源渠道"
        title={selectedLabel}
        disabled={pending}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-4xl outline-none",
          "transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          selected
            ? "size-5 hover:opacity-80"
            : "h-7 gap-1.5 bg-muted px-2.5 text-xs font-medium hover:bg-muted/70",
          className,
        )}
      >
        {selected ? (
          <ChannelIcon
            icon={selected.channel.iconData}
            color={selected.channel.color}
            size="md"
          />
        ) : (
          "来源渠道"
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => change(NO_CHANNEL)}>
          <span className="text-muted-foreground">未指定</span>
          {value === NO_CHANNEL ? (
            <CheckIcon className="ml-auto size-4 text-muted-foreground" />
          ) : null}
        </DropdownMenuItem>

        {sourceChannels.length > 0 ? <DropdownMenuSeparator /> : null}

        {sourceChannels.map((node) =>
          // 默认只列一级大类，二级收进子菜单；一级本身也能选，所以子菜单里先放它自己
          node.children.length > 0 ? (
            <DropdownMenuSub key={node.id}>
              <DropdownMenuSubTrigger>
                <ChannelIcon icon={node.iconData} color={node.color} />
                <span className="truncate">{node.name}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem onSelect={() => change(String(node.id))}>
                  <ChannelIcon icon={node.iconData} color={node.color} />
                  <span>整个大类</span>
                  {value === String(node.id) ? (
                    <CheckIcon className="ml-auto size-4" />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {node.children.map((child) => (
                  <DropdownMenuItem
                    key={child.id}
                    onSelect={() => change(String(child.id))}
                  >
                    <ChannelIcon icon={child.iconData} color={child.color} />
                    <span className="truncate">{child.name}</span>
                    {value === String(child.id) ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem key={node.id} onSelect={() => change(String(node.id))}>
              <ChannelIcon icon={node.iconData} color={node.color} />
              <span className="truncate">{node.name}</span>
              {value === String(node.id) ? (
                <CheckIcon className="ml-auto size-4" />
              ) : null}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
