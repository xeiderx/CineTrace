import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DOUBAN_REMOVED_LABEL, mediaTypeLabel, viewStatusLabel, viewStatusTone } from "@/lib/labels";
import { posterUrl } from "@/lib/queries";

/** 五角星评分展示，只读 */
export function RatingStars({
  value,
  size = 12,
}: {
  value: number | null | undefined;
  size?: number;
}) {
  if (value == null) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`评分 ${value} 分`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={
            i < value
              ? "fill-primary text-primary"
              : "fill-transparent text-muted-foreground/40"
          }
        />
      ))}
    </span>
  );
}

/** 无海报时的占位：片名首字 + 胶片纹理 */
function PosterFallback({ title }: { title: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/80 to-muted/30">
      <span className="text-3xl font-semibold text-muted-foreground/50">
        {title.slice(0, 1)}
      </span>
    </div>
  );
}

/**
 * 作品卡片。海报走 TMDB 图床，手动录入的作品允许直接填外链，
 * 因此这里用原生 img 而不做域名白名单。
 */
export function WorkPoster({
  title,
  posterPath,
  className,
}: {
  title: string;
  posterPath: string | null;
  className?: string;
}) {
  const src = posterUrl(posterPath);
  return (
    <div
      className={`relative aspect-[2/3] w-full overflow-hidden bg-muted ${className ?? ""}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${title} 海报`}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <PosterFallback title={title} />
      )}
    </div>
  );
}

/** 作品在列表中的元信息标签行 */
export function WorkMetaBadges({
  mediaType,
  year,
  status,
  watchCount,
  country,
  removedCount = 0,
}: {
  mediaType: string;
  year: number | null;
  status: string | null;
  watchCount: number;
  /** 制片国家，列表里只展示第一个，多了卡片放不下 */
  country?: string | null;
  /** 「豆瓣已移除」标记的流水条数，0 表示不展示 */
  removedCount?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="font-normal">
        {mediaTypeLabel(mediaType)}
      </Badge>
      {year ? (
        <span className="text-xs text-muted-foreground">{year}</span>
      ) : null}
      {country ? (
        <span className="truncate text-xs text-muted-foreground">{country}</span>
      ) : null}
      {status ? (
        <span
          className={`inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium ${viewStatusTone(status)}`}
        >
          {viewStatusLabel(status)}
        </span>
      ) : null}
      {watchCount > 1 ? (
        <span className="text-xs text-muted-foreground">{watchCount} 刷</span>
      ) : null}
      {removedCount > 0 ? (
        <span
          className="inline-flex h-5 items-center rounded-4xl bg-amber-500/15 px-2 text-xs font-medium text-amber-400"
          title="最后一次全量同步时，这些记录已不在豆瓣列表上"
        >
          {DOUBAN_REMOVED_LABEL}
        </span>
      ) : null}
    </div>
  );
}

/** 剧集进度文案：S2E05（共 12 集） */
export function progressLabel({
  mediaType,
  progressSeason,
  progressEpisode,
  episodesWatched,
}: {
  mediaType: string;
  progressSeason: number | null;
  progressEpisode: number | null;
  episodesWatched: number | null;
}): string | null {
  if (mediaType !== "tv") return null;
  if (progressSeason == null && progressEpisode == null) {
    return episodesWatched ? `已看 ${episodesWatched} 集` : null;
  }
  const head =
    progressSeason != null && progressEpisode != null
      ? `S${progressSeason}E${String(progressEpisode).padStart(2, "0")}`
      : progressEpisode != null
        ? `第 ${progressEpisode} 集`
        : `第 ${progressSeason} 季`;
  return episodesWatched ? `${head} · 共 ${episodesWatched} 集` : head;
}
