import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceChannelNode } from "@/lib/queries";

/**
 * 在两级树里按 id 找渠道，顺带带上它的一级名，用于拼「一级 › 二级」。
 * 选择器与观影记录弹窗都要用，放这里免得各写一份。
 */
export function findChannel(sourceChannels: SourceChannelNode[], id: number) {
  for (const node of sourceChannels) {
    if (node.id === id) return { channel: node, parentName: null };
    for (const child of node.children) {
      if (child.id === id) return { channel: child, parentName: node.name };
    }
  }
  return null;
}

/**
 * 来源渠道图标。
 *
 * 渠道可能上传了图片（data URL），也可能只设了标识色，两者都没有时用 Layers
 * 图标兜底——选择器的触发按钮始终得有个可点的视觉锚点，不能是空白。
 * 纯展示、不带状态，服务端组件与客户端组件都能直接用。
 */
export function ChannelIcon({
  icon,
  color,
  size = "sm",
  className,
}: {
  /** 渠道图片，对应 `source_channel.icon_data` */
  icon: string | null;
  /** 渠道标识色，没有图片时用它给占位图标上色 */
  color: string | null;
  /** sm 用于列表徽标与筛选 chip，md 用于详情页的徽标行与观影流水 */
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "md" ? "size-5" : "size-4";

  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        className={cn(box, "shrink-0 rounded-sm object-contain", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        box,
        "flex shrink-0 items-center justify-center rounded-sm",
        className,
      )}
      style={color ? { color } : undefined}
    >
      <Layers className={size === "md" ? "size-3.5" : "size-3"} />
    </span>
  );
}
