import type { ReactNode } from "react";

/**
 * 登录 / 首次引导共用的居中布局。
 * 背景做了低成本的「放映厅」氛围：径向光晕 + 暗角，不使用图片资源。
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center px-6 py-10">
      {/* 光晕与暗角 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-18rem] size-[38rem] -translate-x-1/2 rounded-full bg-primary/12 blur-[120px]" />
        <div className="absolute bottom-[-14rem] right-[-10rem] size-[30rem] rounded-full bg-chart-2/10 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,var(--background)_100%)]" />
      </div>

      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}
