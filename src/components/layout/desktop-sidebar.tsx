"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, type NavItem } from "@/lib/nav";
import { BrandMark } from "@/components/brand/logo";
import { APP_VERSION_LABEL } from "@/lib/version";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function DesktopNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      {/* 左侧高亮条：当前页标识 */}
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground",
        )}
      />
      {item.label}
    </Link>
  );
}

/** 桌面端固定侧边栏。移动端由 bottom-nav 承担导航，此组件隐藏。 */
export function DesktopSidebar({ footer }: { footer?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-16 items-center px-5">
        <BrandMark size={28} subtitle={APP_VERSION_LABEL} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <DesktopNavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
          />
        ))}

        <div className="my-3 h-px bg-sidebar-border" />

        {SECONDARY_NAV_ITEMS.map((item) => (
          <DesktopNavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
          />
        ))}
      </nav>

      {footer ? (
        <div className="border-t border-sidebar-border p-3">{footer}</div>
      ) : null}
    </aside>
  );
}
