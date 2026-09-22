import { NextResponse } from "next/server";
import { loadIconLibrary } from "@/lib/icon-library";
import { getOptionalUser } from "@/lib/session";

/**
 * 读取某个图标库的图标清单。
 *
 * 走服务端代理而不是让浏览器直连 GitHub：图标库的图都在
 * raw.githubusercontent.com 上，国内直连不稳定，服务端已配好环境变量代理。
 * proxy 的 matcher 排除了 /api，因此这里必须自己鉴权。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authUser = await getOptionalUser();
  if (!authUser) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "图标库 id 不合法" }, { status: 400 });
  }

  try {
    const library = await loadIconLibrary(id);
    return NextResponse.json(library, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取图标库失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
