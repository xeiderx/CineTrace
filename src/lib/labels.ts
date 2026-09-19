/** 数据库中枚举值到中文展示的映射，服务端与客户端组件共用 */

export type MediaType = "movie" | "tv";
export type ViewStatus = "watched" | "watching" | "wish" | "on_hold" | "dropped";
export type MatchStatus = "matched" | "manual" | "pending" | "failed";

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  movie: "电影",
  tv: "剧集",
};

export const VIEW_STATUS_LABELS: Record<ViewStatus, string> = {
  watched: "看过",
  watching: "在看",
  wish: "想看",
  on_hold: "搁置",
  dropped: "弃剧",
};

/** 状态的展示配色，用于徽标 */
export const VIEW_STATUS_TONES: Record<ViewStatus, string> = {
  watched: "bg-emerald-500/15 text-emerald-400",
  watching: "bg-primary/15 text-primary",
  wish: "bg-sky-500/15 text-sky-400",
  on_hold: "bg-amber-500/15 text-amber-400",
  dropped: "bg-muted text-muted-foreground",
};

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched: "已匹配",
  manual: "手动指定",
  pending: "待匹配",
  failed: "匹配失败",
};

export const VIEW_STATUS_ORDER: ViewStatus[] = [
  "watched",
  "watching",
  "wish",
  "on_hold",
  "dropped",
];

export function mediaTypeLabel(value: string): string {
  return MEDIA_TYPE_LABELS[value as MediaType] ?? value;
}

export function viewStatusLabel(value: string): string {
  return VIEW_STATUS_LABELS[value as ViewStatus] ?? value;
}

export function viewStatusTone(value: string): string {
  return VIEW_STATUS_TONES[value as ViewStatus] ?? "bg-muted text-muted-foreground";
}

/** ISO 日期（YYYY-MM-DD）转展示文本，null 显示占位符 */
export function formatDate(value: string | null | undefined, fallback = "—"): string {
  return value?.trim() ? value : fallback;
}

/** 分钟数转「x 小时 y 分钟」 */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分`;
}

/** 还原 JSON 数组列的文本值，解析失败按空数组处理 */
export function parseStringList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 主演条目。存进 `work.cast` 的 JSON 数组元素。
 * `id` 是 TMDB person id——手动录入的演员没有 id，因此取不到头像与简介。
 */
export type CastMember = {
  id: number | null;
  name: string;
  /** 饰演角色，手动录入时为 null */
  character: string | null;
  /** TMDB 头像相对路径，手动录入时为 null */
  profilePath: string | null;
};

/**
 * 还原 `work.cast` 列。
 *
 * 老数据是纯姓名数组（`["张三","李四"]`，早前的手动录入格式），
 * 因此这里对字符串元素做兼容，统一升级成结构化对象，
 * 免得升级后旧记录整个读不出来。
 */
export function parseCast(value: string | null | undefined): CastMember[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const out: CastMember[] = [];
    for (const entry of parsed) {
      if (typeof entry === "string") {
        const name = entry.trim();
        if (name) out.push({ id: null, name, character: null, profilePath: null });
        continue;
      }
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!name) continue;
      out.push({
        id: typeof entry.id === "number" ? entry.id : null,
        name,
        character: typeof entry.character === "string" ? entry.character : null,
        profilePath: typeof entry.profilePath === "string" ? entry.profilePath : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 编辑表单里主演是纯文本输入（顿号/逗号分隔），
 * 保存时按姓名把旧的头像与 person id 贴回去——否则改一次片名
 * 就会把抓来的头像全冲掉。没匹配上的名字视为新增，id 留空。
 */
export function mergeCast(existing: CastMember[], names: string[]): CastMember[] {
  const pool = [...existing];
  const out: CastMember[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = pool.findIndex((c) => c.name === name);
    if (hit >= 0) {
      out.push(pool[hit]);
      pool.splice(hit, 1);
    } else {
      out.push({ id: null, name, character: null, profilePath: null });
    }
  }
  return out;
}

/** 日期区间文案：2024-01-01 → 2024-03-05，缺一侧则只显示另一侧 */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const from = start?.trim();
  const to = end?.trim();
  if (from && to) return from === to ? from : `${from} → ${to}`;
  return from ?? to ?? null;
}
