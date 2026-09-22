import { NextResponse } from "next/server";
import sharp from "sharp";
import { fetchLibraryIcon } from "@/lib/icon-library";
import { getOptionalUser } from "@/lib/session";

/**
 * 取图标库里的一张图，顺带按请求宽度缩略。
 *
 * 库里原图动辄 1000px 以上、单张最大 1.5MB，而列表里只按 48px 显示，
 * 直接转发原图会让一个网格拉出几十 MB。这里用 sharp 缩到目标宽度再返回，
 * 缩略结果进内存缓存，同一张图第二次请求不再解码。
 *
 * proxy 的 matcher 排除了 /api，因此这里必须自己鉴权。
 */

/** 允许的缩略宽度。写死几档，避免被当成任意尺寸的图片处理服务 */
const ALLOWED_WIDTHS = [48, 96, 192];
const DEFAULT_WIDTH = 48;
/** 缩略图缓存条数上限。一张 48px PNG 约 3-6KB，600 条也就几 MB */
const MAX_CACHE_ENTRIES = 600;

const thumbCache = new Map<string, Buffer>();

function remember(key: string, value: Buffer) {
  // Map 的迭代顺序即插入顺序，超出上限就丢最早的一条
  if (thumbCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = thumbCache.keys().next().value;
    if (oldest != null) thumbCache.delete(oldest);
  }
  thumbCache.set(key, value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authUser = await getOptionalUser();
  if (!authUser) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const id = Number((await params).id);
  const search = new URL(request.url).searchParams;
  const url = search.get("url") ?? "";
  const requested = Number(search.get("w"));
  const width = ALLOWED_WIDTHS.includes(requested) ? requested : DEFAULT_WIDTH;

  if (!Number.isInteger(id) || !url) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const cacheKey = `${id}|${width}|${url}`;
  const cached = thumbCache.get(cacheKey);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  }

  try {
    const { data } = await fetchLibraryIcon(id, url);
    // 统一转 PNG：透明底保留，前端也不用再管原图是什么格式
    const resized = await sharp(data)
      .resize({ width, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();

    remember(cacheKey, resized);
    return new NextResponse(new Uint8Array(resized), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "取图失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
