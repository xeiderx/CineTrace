import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-constants";

/**
 * Edge 运行时拿不到 SQLite，这里只做「有没有 Cookie」的粗筛，
 * 好处是未登录用户不必等 Node 层渲染。
 * 真正的会话校验在受保护布局里用数据库完成。
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // 首次引导页必须在未登录时可达，否则会和 /login 相互重定向成死循环
  if (pathname === "/setup") {
    return NextResponse.next();
  }

  if (pathname === "/login") {
    // 已登录用户访问登录页，直接送回首页
    if (hasCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasCookie) {
    const loginUrl = new URL("/login", request.url);
    // 登录后跳回原目标
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 保护全部页面路由，放行：
     * - /login 登录页
     * - /api 下的接口（自行校验，避免中间件拦截同步回调）
     * - Next 静态资源与图标
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt).*)",
  ],
};
