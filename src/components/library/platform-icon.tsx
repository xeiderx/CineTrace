import {
  Circle,
  Clapperboard,
  Laptop,
  MonitorPlay,
  Smartphone,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 平台图标名到组件的映射。用户可填的名字有限，未收录时退化为圆点。 */
const ICONS: Record<string, LucideIcon> = {
  "monitor-play": MonitorPlay,
  laptop: Laptop,
  smartphone: Smartphone,
  clapperboard: Clapperboard,
  tv: Tv,
  circle: Circle,
};

/** 内置图标名清单，供设置页的 IconField 一键选中 */
export const PLATFORM_ICON_NAMES = Object.keys(ICONS);

/** 尺寸档位：列表徽标用 sm，详情页徽标行用 md */
const PLATFORM_ICON_SIZE = {
  sm: "size-4",
  md: "size-5",
} as const;

/**
 * 观影平台图标。
 *
 * `platform.icon` 有两种写法：内置图标名（lucide）或从图标库选来的 data URL。
 * 按前缀区分，图片直接画 `<img>`，其余按名字查内置图标；名字为空或未收录时
 * 用圆点兜底，免得触发按钮变成一块空白。纯展示、不带状态，服务端组件也能用。
 */
export function PlatformIcon({
  icon,
  size = "sm",
  className,
}: {
  /** 平台图标，对应 `platform.icon` */
  icon: string | null;
  /** sm 用于设置页列表与流水 chip，md 用于详情页的徽标行 */
  size?: keyof typeof PLATFORM_ICON_SIZE;
  className?: string;
}) {
  const box = PLATFORM_ICON_SIZE[size];

  if (icon?.startsWith("data:")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        className={cn(box, "shrink-0 object-contain", className)}
      />
    );
  }

  const Icon = (icon && ICONS[icon]) || Circle;
  return <Icon className={cn(box, "shrink-0", className)} />;
}
