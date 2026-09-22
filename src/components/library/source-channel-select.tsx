"use client";

import { useState, useTransition } from "react";
import { updateRecordSourceChannelAction } from "@/app/actions/library";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SourceChannelNode } from "@/lib/queries";

/** 与观影记录弹窗同一约定：「未指定」用哨兵值，action 里 parseInt 解析不出会落成 null */
const NO_CHANNEL = "__no_channel__";

function toValue(id: number | null | undefined): string {
  return id == null ? NO_CHANNEL : String(id);
}

/**
 * 内嵌的来源渠道下拉，直接挂在页面上用。
 *
 * 来源渠道与标签一样属于「某一次观看」，不属于作品：没有现成的流水时无处可挂，
 * 调用方应先判断有没有流水，再决定渲染本组件还是提示去记一次观看。
 *
 * 选中即提交，只改这一条流水的来源渠道（走 updateRecordSourceChannelAction，
 * 不碰状态、日期等其它字段），随后由 action 里的 revalidatePath 把新值回传下来。
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

  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger
        size="sm"
        aria-label="来源渠道"
        disabled={pending}
        className={cn("rounded-4xl", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CHANNEL}>未指定来源渠道</SelectItem>
        {sourceChannels.map((node) => (
          // 一级分类本身也能选，因此每组里先放它自己，再列二级
          <SelectGroup key={node.id}>
            <SelectLabel>{node.name}</SelectLabel>
            <SelectItem value={String(node.id)}>
              {node.name}
              <span className="text-xs text-muted-foreground">（整个大类）</span>
            </SelectItem>
            {node.children.map((child) => (
              <SelectItem key={child.id} value={String(child.id)}>
                {child.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
