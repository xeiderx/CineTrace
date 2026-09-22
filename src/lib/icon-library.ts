import { eq } from "drizzle-orm";
import { EnvHttpProxyAgent, fetch } from "undici";
import { db } from "@/db";
import { iconLibrary } from "@/db/schema";

/**
 * 外部图标库的读取。
 *
 * 图标库就是一份公网 JSON，形如：
 *   { "name": "库名", "description": "说明", "icons": [{ "name": "图标名", "url": "..." }] }
 * 各家字段基本一致，这里只取 name / url，其余忽略。
 *
 * 为什么走服务端代理而不是让浏览器直连：图标与 JSON 大多挂在
 * raw.githubusercontent.com 上，国内直连不稳定；服务端已经配好了
 * 环境变量代理（与 TMDB、豆瓣抓取同一套），顺手复用它。
 */

/** 与 TMDB / 豆瓣共用同一套代理分流策略 */
const dispatcher = new EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY });

const FETCH_TIMEOUT_MS = 20_000;
/** 图标库 JSON 上限，正常在 1MB 以内，超过说明不是图标库 */
const MAX_JSON_BYTES = 8 * 1024 * 1024;
/** 单张图标上限。实测最大 1.5MB（1229×1229 的 PNG），留些余量 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 解析结果缓存时长。图标库在 GitHub 上很少变动，没必要每次开选图弹窗都重拉 */
const CACHE_TTL_MS = 10 * 60 * 1000;

export type LibraryIcon = { name: string; url: string };

export type LibraryContent = {
  /** JSON 里自称的名字，仅作展示；设置页的库名以数据库为准 */
  name: string;
  description: string;
  icons: LibraryIcon[];
};

type CacheEntry = { at: number; data: LibraryContent };
const cache = new Map<number, CacheEntry>();

/** 带超时的取回，超时与网络错误都归一成一句人话 */
async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // 用 undici 的 fetch：Node 全局 fetch 不认 dispatcher，走不了环境变量代理
    return await fetch(url, { dispatcher, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`连接图标库失败：${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 从 JSON 里挑出可用的图标项，脏数据直接丢掉而不是整体报错 */
function parseIcons(payload: unknown): LibraryIcon[] {
  const raw = (payload as { icons?: unknown })?.icons;
  if (!Array.isArray(raw)) return [];

  const icons: LibraryIcon[] = [];
  for (const item of raw) {
    const row = item as { name?: unknown; url?: unknown };
    const url = typeof row?.url === "string" ? row.url.trim() : "";
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!url) continue;
    icons.push({ name: name || url, url });
  }
  return icons;
}

/**
 * 读取指定图标库的内容（带内存缓存）。
 *
 * 缓存以库 id 为键，库地址被改动时 action 会清掉对应缓存，
 * 因此不需要在键里带上 url。
 */
export async function loadIconLibrary(id: number): Promise<LibraryContent> {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const row = db.select().from(iconLibrary).where(eq(iconLibrary.id, id)).get();
  if (!row) throw new Error("图标库不存在");

  const response = await fetchWithTimeout(row.url);
  if (!response.ok) {
    throw new Error(`图标库返回 ${response.status}，请检查地址是否正确`);
  }

  const text = await response.text();
  if (text.length > MAX_JSON_BYTES) throw new Error("图标库文件过大，可能不是图标库地址");

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("图标库不是合法的 JSON，请检查地址");
  }

  const data: LibraryContent = {
    name: typeof (payload as { name?: unknown })?.name === "string"
      ? ((payload as { name: string }).name)
      : row.name,
    description: typeof (payload as { description?: unknown })?.description === "string"
      ? ((payload as { description: string }).description)
      : "",
    icons: parseIcons(payload),
  };

  cache.set(id, { at: Date.now(), data });
  return data;
}

/** 地址或名称改动后丢弃缓存，下次读取重新拉取 */
export function invalidateIconLibraryCache(id: number): void {
  cache.delete(id);
}

/**
 * 取单张图标。只接受「确实出现在该图标库列表里」的地址，
 * 以免这个路由变成可以打任意内网地址的代理。
 */
export async function fetchLibraryIcon(
  libraryId: number,
  url: string,
): Promise<{ data: Buffer; contentType: string }> {
  const library = await loadIconLibrary(libraryId);
  if (!library.icons.some((icon) => icon.url === url)) {
    throw new Error("该图标不属于这个图标库");
  }

  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`图标下载失败（${response.status}）`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error("目标地址不是图片");

  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error("图标文件过大");

  return { data, contentType };
}
