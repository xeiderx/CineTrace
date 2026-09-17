import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** 空态占位：骨架阶段各页面共用，后续替换为真实内容 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-6 py-16 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted/60">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
