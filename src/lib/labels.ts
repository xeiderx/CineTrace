/** 数据库中枚举值到中文展示的映射，服务端与客户端组件共用 */

export type MediaType = "movie" | "tv";
export type ViewStatus = "watched" | "watching" | "wish" | "on_hold" | "dropped";
export type MatchStatus = "matched" | "manual" | "failed";

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  movie: "电影",
  tv: "剧集",
};

export const VIEW_STATUS_LABELS: Record<ViewStatus, string> = {
  watched: "看过",
  watching: "在看",
  wish: "想看",
  on_hold: "搁置",
  dropped: "弃看",
};

/**
 * 状态徽标用的单字：看过=看、在看=追、想看=想、搁置=搁、弃看=弃。
 *
 * 档案库卡片的元信息行只有一行位置，写全称会把「日期 + 状态 + 移除标记」挤爆，
 * 所以缩成一个字，靠配色区分。
 */
export const VIEW_STATUS_GLYPHS: Record<ViewStatus, string> = {
  watched: "看",
  watching: "追",
  wish: "想",
  on_hold: "搁",
  dropped: "弃",
};

/** 状态的展示配色，用于徽标 */
export const VIEW_STATUS_TONES: Record<ViewStatus, string> = {
  watched: "bg-emerald-500/15 text-emerald-400",
  watching: "bg-primary/15 text-primary",
  wish: "bg-sky-500/15 text-sky-400",
  on_hold: "bg-amber-500/15 text-amber-400",
  dropped: "bg-muted text-muted-foreground",
};

/**
 * 标签可选颜色的预设色板。
 *
 * 挑的是中高亮度、饱和度适中的色号：标签用的是「15% 淡底 + 同色文字」，
 * 这套色号在深色主题下当文字够亮，做成淡底也不发灰。
 * 与平台标识色的取色习惯（暖金 / 蓝 / 紫 / 红）保持同一调性。
 */
export const TAG_COLOR_PRESETS: string[] = [
  "#e0a458",
  "#e06c75",
  "#e07ba0",
  "#cf7bd0",
  "#9b7bd5",
  "#7b8ce0",
  "#5b9bd5",
  "#54b6c8",
  "#4fbfa8",
  "#6fc27c",
  "#a3b75a",
  "#9aa4b2",
];

/**
 * 标签胶囊的配色：标签色的 15% 淡底 + 同色文字，与 `VIEW_STATUS_TONES` 同一套观感。
 *
 * 用 color-mix 而不是拼 8 位 hex：颜色值可能来自原生取色器，
 * 也可能被人手工填成 rgb() 之类的写法，拼字符串前缀会直接失效。
 * 未设颜色时返回 undefined，由调用方回落到中性的 muted 样式。
 */
export function tagChipStyle(
  color: string | null | undefined,
): { color: string; backgroundColor: string } | undefined {
  const value = color?.trim();
  if (!value) return undefined;
  return {
    color: value,
    backgroundColor: `color-mix(in srgb, ${value} 15%, transparent)`,
  };
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched: "已匹配",
  manual: "自由添加",
  failed: "待匹配",
};

/**
 * 「待补全」不是 work.match_status 的取值，而是「有 tmdbId 但元数据没拉全」
 * 的派生筛选（见 lib/backup.ts 的 pendingMetadataWhere），
 * 因此单独作为一个筛选项值，与匹配状态并列在下拉里。
 */
export const PENDING_METADATA_FILTER = "pending_metadata";

/**
 * 档案库「匹配状态」下拉的选项：已匹配 → 待补全 → 待匹配 → 自由添加。
 * 「待补全」是派生条件，「自由添加」是无 TMDB 数据的手工条目，也排在最后。
 */
export const MATCH_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "matched", label: MATCH_STATUS_LABELS.matched },
  { value: PENDING_METADATA_FILTER, label: "待补全" },
  { value: "failed", label: MATCH_STATUS_LABELS.failed },
  { value: "manual", label: MATCH_STATUS_LABELS.manual },
];

/**
 * 「豆瓣已移除」是观影流水上的派生标记（`view_record.douban_removed_at` 非空），
 * 不是状态或匹配状态的取值，因此单独作为档案库的一个筛选项。
 */
export const DOUBAN_REMOVED_FILTER = "douban_removed";

/** 「豆瓣已移除」标记的统一文案，徽标、筛选下拉与提示行共用 */
export const DOUBAN_REMOVED_LABEL = "豆瓣已移除";

/**
 * 匹配状态的展示文案。手动绑定但拿到了 TMDB 数据的直接算「已匹配」，
 * 只有始终没有 TMDB 数据的手工条目才叫「自由添加」。
 */
export function matchStatusLabel(value: string, tmdbId: number | null): string {
  if (value === "manual") return tmdbId == null ? "自由添加" : "已匹配";
  return MATCH_STATUS_LABELS[value as MatchStatus] ?? value;
}

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

/** 状态单字；未知取值原样返回，避免脏数据渲染成空白 */
export function viewStatusGlyph(value: string): string {
  return VIEW_STATUS_GLYPHS[value as ViewStatus] ?? value;
}

/**
 * 可以被「手动锁定」的观影流水字段。
 *
 * 只收录豆瓣同步会写入的字段：手动改过这些字段后，下次同步不再用豆瓣的值覆盖
 * （落在 `view_record.manual_fields_json` 上）。平台、刷次这类同步不碰的字段
 * 没必要锁，锁了只会让界面多出一堆无意义的标记。
 */
export type ViewRecordField =
  | "status"
  | "watchedAt"
  | "startedAt"
  | "finishedAt"
  | "rating"
  | "comment"
  | "progressSeason";

export const VIEW_RECORD_FIELDS: ViewRecordField[] = [
  "status",
  "watchedAt",
  "startedAt",
  "finishedAt",
  "rating",
  "comment",
  "progressSeason",
];

export const VIEW_RECORD_FIELD_LABELS: Record<ViewRecordField, string> = {
  status: "观看状态",
  watchedAt: "标记日期",
  startedAt: "开始观看",
  finishedAt: "看完日期",
  rating: "评分",
  comment: "短评",
  progressSeason: "归属季",
};

/** 锁定字段的展示文案。库里存的是字段名，界面要显示中文 */
export function viewRecordFieldLabel(field: string): string {
  return VIEW_RECORD_FIELD_LABELS[field as ViewRecordField] ?? field;
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
