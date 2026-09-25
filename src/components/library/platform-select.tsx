"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { updateRecordPlatformAction } from "@/app/actions/library";
import { PlatformIcon } from "@/components/library/platform-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Platform } from "@/db/schema";
import { cn } from "@/lib/utils";

/** 与观影记录弹窗同一约定：「跟随默认」用哨兵值，action 里 parseInt 解析不出会落成 null */
const USE_DEFAULT = "__default__";

function toValue(id: number | null | undefined): string {
  return id == null ? USE_DEFAULT : String(id);
}

/**
 * 内嵌的观影平台选择器，直接挂在页面上用。
 *
 * 平台是「某一次观看」的属性：流水没单独指定时跟随全局默认平台（`platformId`
 * 存 null）。选中即提交，只改这一条流水的 `platformId`，不碰状态与日期等其它
 * 字段，随后由 action 里的 revalidatePath 把新值回传下来。
 *
 * 两种形态：chip 用于观影记录里（图标 + 平台名，跟随默认时补一个「（默认）」），
 * icon 用于详情页头部的徽标行（只留图标，平台名进 title）。
 */
export function PlatformSelect({
  viewRecordId,
  current,
  platforms,
  variant = "chip",
  className,
}: {
  /** 平台要落到哪条流水上 */
  viewRecordId: number;
  /** 这条流水当前的平台 id，null 表示跟随默认平台 */
  current: number | null;
  /** 全部平台，默认平台由 `isDefault` 标出 */
  platforms: Platform[];
  /** chip 显示图标 + 名称，icon 只显示图标 */
  variant?: "chip" | "icon";
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
    formData.set("platformId", next);
    startTransition(() => void updateRecordPlatformAction(formData));
  }

  const defaultPlatform =
    platforms.find((p) => p.isDefault) ?? platforms[0] ?? null;
  const selectedId = value === USE_DEFAULT ? null : Number.parseInt(value, 10);
  // 找不到就按默认平台展示：平台被删掉时数据库也会把 platformId 落回 null
  const matched =
    selectedId != null
      ? (platforms.find((p) => p.id === selectedId) ?? null)
      : null;
  const platform = matched ?? defaultPlatform;
  const usingDefault = matched == null;

  const label = platform
    ? `${platform.name}${usingDefault ? "（默认）" : ""}`
    : "未指定观影平台";

  // 图标形态只是给已有平台留个「点开就改」的入口；一个平台都没配时
  // 没有可选项，挤出一个 size-5 的文字触发器只会被裁成残字，索性不渲染。
  if (variant === "icon" && !platform) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="观影平台"
        title={label}
        disabled={pending}
        className={cn(
          "inline-flex shrink-0 items-center rounded-4xl outline-none",
          "transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          variant === "icon"
            ? "size-5 justify-center hover:opacity-80"
            : "h-5 gap-1.5 bg-muted px-2 text-xs text-foreground hover:bg-muted/70",
          className,
        )}
      >
        {platform ? (
          <>
            <span
              className="flex shrink-0 items-center"
              style={platform.color ? { color: platform.color } : undefined}
            >
              <PlatformIcon icon={platform.icon} size={variant === "icon" ? "md" : "sm"} />
            </span>
            {variant === "chip" ? (
              <>
                <span className="truncate">{platform.name}</span>
                {usingDefault ? (
                  <span className="shrink-0 text-muted-foreground">（默认）</span>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>观影平台</>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => change(USE_DEFAULT)}>
          <span className="truncate">
            跟随默认
            {defaultPlatform ? `（${defaultPlatform.name}）` : ""}
          </span>
          {value === USE_DEFAULT ? (
            <CheckIcon className="ml-auto size-4 text-muted-foreground" />
          ) : null}
        </DropdownMenuItem>

        {platforms.length > 0 ? <DropdownMenuSeparator /> : null}

        {platforms.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => change(String(item.id))}
          >
            <span
              className="flex shrink-0 items-center"
              style={item.color ? { color: item.color } : undefined}
            >
              <PlatformIcon icon={item.icon} />
            </span>
            <span className="truncate">
              {item.name}
              {item.isDefault ? "（默认）" : ""}
            </span>
            {value === String(item.id) ? (
              <CheckIcon className="ml-auto size-4" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
