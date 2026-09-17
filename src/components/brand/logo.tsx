import { cn } from "@/lib/utils";

/**
 * 品牌标识：光圈（aperture）+ 胶片质感。
 * 用内联 SVG 而非图片，保证深色下清晰且可随主题变色。
 */
export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <circle cx="16" cy="16" r="14" className="fill-primary/12" />
      <circle cx="16" cy="16" r="13.25" strokeWidth="1.5" className="stroke-primary/45" />
      {/* 光圈叶片 */}
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <path
          key={deg}
          d="M16 16 L16 3.5 A12.5 12.5 0 0 1 26.8 9.75 Z"
          transform={`rotate(${deg} 16 16)`}
          className="fill-primary/16 stroke-primary/40"
          strokeWidth="1"
        />
      ))}
      <circle cx="16" cy="16" r="4.25" className="fill-primary" />
      <circle cx="16" cy="16" r="1.6" className="fill-background" />
    </svg>
  );
}

export function BrandMark({
  size = 32,
  className,
  subtitle,
}: {
  size?: number;
  className?: string;
  subtitle?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Logo size={size} />
      <div className="leading-tight">
        <div className="text-lg font-semibold tracking-tight">CineTrace</div>
        {subtitle ? (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
