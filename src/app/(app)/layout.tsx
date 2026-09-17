import type { ReactNode } from "react";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { requireUser } from "@/lib/session";

/**
 * 主应用外壳：桌面端左侧固定侧边栏，移动端底部导航。
 * 进入此处即要求登录态，未登录会被 requireUser 重定向到 /login。
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-svh">
      <DesktopSidebar footer={<UserMenu username={user.username} />} />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10 md:pt-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        <MobileBottomNav />
      </div>
    </div>
  );
}
