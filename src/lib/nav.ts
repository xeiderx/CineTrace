import {
  BarChart3,
  CirclePlay,
  Compass,
  LayoutDashboard,
  Library,
  ListVideo,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * 导航项同时驱动桌面侧边栏与移动端底部导航，
 * 单一数据源避免两端菜单不一致。
 * 移动端底部最多放 5 项，超出部分归入侧边栏。
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/library", label: "档案库", icon: Library },
  { href: "/watching", label: "追剧", icon: CirclePlay },
  { href: "/collections", label: "片单", icon: ListVideo },
  { href: "/stats", label: "统计", icon: BarChart3 },
  { href: "/discover", label: "发现", icon: Compass },
];

/**
 * 桌面端侧边栏额外的次级入口。
 * 移动端底部只有 5 格，追剧要常驻，片单频次低，因此片单落到这里。
 */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { href: "/collections", label: "片单", icon: ListVideo },
  { href: "/settings", label: "设置", icon: Settings },
];

/** 移动端底部导航 */
export const MOBILE_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "概览", icon: LayoutDashboard },
  { href: "/library", label: "档案库", icon: Library },
  { href: "/watching", label: "追剧", icon: CirclePlay },
  { href: "/stats", label: "统计", icon: BarChart3 },
  { href: "/settings", label: "设置", icon: Settings },
];
