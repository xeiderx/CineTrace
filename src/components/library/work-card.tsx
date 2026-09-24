import type { ReactNode } from "react";
import { Ban, CirclePause, Film, Star, Tv, type LucideIcon } from "lucide-react";
import { ChannelIcon } from "@/components/library/channel-icon";
import {
  DOUBAN_REMOVED_LABEL,
  mediaTypeLabel,
  viewStatusGlyph,
  viewStatusLabel,
  viewStatusTone,
} from "@/lib/labels";
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
 * 搁置与弃看的封面处理。
 *
 * 「在看」不加任何东西——封面本来就该是干净的。搁置是暂时的，只压一层暖色雾气
 * 让画面退后一点；弃看是终局，直接抽掉颜色并压暗，扫一眼列表就知道这剧不追了。
 */
const POSTER_STATUS_STYLES: Record<
  string,
  { icon: LucideIcon; label: string; badge: string; image: string }
> = {
  on_hold: {
    icon: CirclePause,
    label: viewStatusLabel("on_hold"),
    badge: "bg-amber-400/95 text-amber-950",
    image: "opacity-80 saturate-[0.45]",
  },
  dropped: {
    icon: Ban,
    label: viewStatusLabel("dropped"),
    badge: "bg-background/85 text-muted-foreground",
    image: "opacity-45 grayscale",
  },
};

/**
 * 刷次徽章的图形素材。
 *
 * 坐标全部按 100×100 的视框设计，圆心在 (50,50)：
 * 锯齿外环是 40 齿的星形多边形，齿顶 r=48、齿谷 r=45.6，齿很短，
 * 远看是一圈细密的光边，不是参考图里那种大尖角。
 */
const CT_TEETH_PATH =
  "M50.00 2.00L53.58 4.54L57.51 2.59L60.65 5.66L64.83 4.35L67.45 7.87L71.79 7.23L73.83 11.12L78.21 11.17L79.61 15.33L83.94 16.06L84.67 20.39L88.83 21.79L88.88 26.17L92.77 28.21L92.13 32.55L95.65 35.17L94.34 39.35L97.41 42.49L95.46 46.42L98.00 50.00L95.46 53.58L97.41 57.51L94.34 60.65L95.65 64.83L92.13 67.45L92.77 71.79L88.88 73.83L88.83 78.21L84.67 79.61L83.94 83.94L79.61 84.67L78.21 88.83L73.83 88.88L71.79 92.77L67.45 92.13L64.83 95.65L60.65 94.34L57.51 97.41L53.58 95.46L50.00 98.00L46.42 95.46L42.49 97.41L39.35 94.34L35.17 95.65L32.55 92.13L28.21 92.77L26.17 88.88L21.79 88.83L20.39 84.67L16.06 83.94L15.33 79.61L11.17 78.21L11.12 73.83L7.23 71.79L7.87 67.45L4.35 64.83L5.66 60.65L2.59 57.51L4.54 53.58L2.00 50.00L4.54 46.42L2.59 42.49L5.66 39.35L4.35 35.17L7.87 32.55L7.23 28.21L11.12 26.17L11.17 21.79L15.33 20.39L16.06 16.06L20.39 15.33L21.79 11.17L26.17 11.12L28.21 7.23L32.55 7.87L35.17 4.35L39.35 5.66L42.49 2.59L46.42 4.54Z";

/** 五角星：以原点为中心，供 transform 摆位 */
const CT_STAR_BIG =
  "M0.00 -4.30L1.06 -1.46L4.09 -1.33L1.71 0.56L2.53 3.48L0.00 1.80L-2.53 3.48L-1.71 0.56L-4.09 -1.33L-1.06 -1.46Z";
const CT_STAR_MID =
  "M0.00 -5.00L1.23 -1.70L4.76 -1.55L2.00 0.65L2.94 4.05L0.00 2.10L-2.94 4.05L-2.00 0.65L-4.76 -1.55L-1.23 -1.70Z";
const CT_STAR_TINY =
  "M0.00 -1.90L0.47 -0.65L1.81 -0.59L0.76 0.25L1.12 1.54L0.00 0.80L-1.12 1.54L-0.76 0.25L-1.81 -0.59L-0.47 -0.65Z";

/**
 * 内圈那串小星的角度。
 *
 * 只在竖直方向的两段连续排布（108°~252° 与其对侧 288°~72°），
 * 水平方向留空——文字带两端正好顶到外环内缘，星尖被长带压住会出脏边。
 * 每段 25 颗、步长 6°，两段合计 50 颗。
 */
const CT_TINY_STAR_ANGLES = Array.from({ length: 25 }, (_, i) => 108 + i * 6).flatMap(
  (angle) => [angle, angle + 180],
);

/** 文字带上下各三颗星，中间那颗稍大 */
const CT_BAND_STARS: { x: number; y: number; mid: boolean }[] = [
  { x: 38, y: 28, mid: false },
  { x: 50, y: 28, mid: true },
  { x: 62, y: 28, mid: false },
  { x: 38, y: 72, mid: false },
  { x: 50, y: 72, mid: true },
  { x: 62, y: 72, mid: false },
];

/**
 * 刷次徽章配色。
 *
 * 这几组颜色硬编码、不走主题变量：金属色本来就是实物色，深色主题下把银色
 * 翻成深灰、浅色主题下把金色翻成土黄，都会失去「银章 / 金章」的辨识度。
 *
 * 章面是一层半透明深墨（见 WATCH_BADGE_FACE_SHADE）：把海报压暗、又不完全挡住，
 * 章体因此在任何海报上都有自己的底，不再依赖背景明暗。
 * 章面变深后深墨线条会消失，所以齿环、内外圈、小星一律改用本档金属亮色。
 */
type WatchBadgeTier = {
  /** 本档金属主色：文字带填充，同时用作齿环、内外圈、小星的刻线 */
  metal: string;
  /** 深墨：金属带上的描边，以及全部文字本体 */
  ink: string;
  /** 大字光晕：同色系里更亮的一档，给深墨大字在深章面上垫底 */
  halo: string;
};

/**
 * 章面底色与不透明度。
 *
 * 深墨 + 0.8：海报明暗仍透得上来（保留参考图那种「像透明」的质感），
 * 但压得够重，章体轮廓不会被浅色海报吃掉。
 */
const WATCH_BADGE_FACE_SHADE = "#0E1116";
const WATCH_BADGE_FACE_OPACITY = 0.8;

/** 倒序排列，取第一个够用的档位；6 刷及以上统一走铂金 */
const WATCH_BADGE_TIERS: { minIndex: number; tier: WatchBadgeTier }[] = [
  {
    minIndex: 6,
    tier: {
      metal: "#B5C4D3",
      ink: "#1B242E",
      halo: "#C9D6E2",
    },
  },
  {
    minIndex: 5,
    tier: {
      metal: "#B3A7E4",
      ink: "#241C46",
      halo: "#CFC6F2",
    },
  },
  {
    minIndex: 4,
    tier: {
      metal: "#E1C87F",
      ink: "#33280A",
      halo: "#F3E3AE",
    },
  },
  {
    minIndex: 3,
    tier: {
      metal: "#DBDFE4",
      ink: "#2A2F36",
      halo: "#EDF0F3",
    },
  },
  {
    minIndex: 2,
    tier: {
      metal: "#CEA180",
      ink: "#2E1A08",
      halo: "#EBCBAE",
    },
  },
];

/** 1 刷（首刷）不出徽章，返回 null */
function watchBadgeTier(watchIndex: number): WatchBadgeTier | null {
  if (watchIndex < 2) return null;
  return WATCH_BADGE_TIERS.find((item) => watchIndex >= item.minIndex)?.tier ?? null;
}

/**
 * 章面数字。用大写数字（贰叁肆伍）而非「二三四五」，笔画多、结构稳，
 * 配合毛笔楷书才压得住章面。6 刷以上统一写 N，真实次数放在 aria-label 与 title 里。
 */
const WATCH_BADGE_NUMERALS: Record<number, string> = {
  2: "贰",
  3: "叁",
  4: "肆",
  5: "伍",
};

/**
 * 大字数字专用字体：毛笔楷书 Ma Shan Zheng，内嵌在 globals.css。
 *
 * 只给「贰叁肆伍N」用，「刷」走页面默认的无衬线字体——一粗一细、一书法一印刷，
 * 两种字体在同一枚章面上对冲，比通体毛笔更有张力。
 * 该字体只提供 400 字重，所以不设 fontWeight，否则浏览器会合成加粗把笔锋糊掉。
 */
const WATCH_BADGE_NUMERAL_FONT = '"Ma Shan Zheng", "Geist", serif';

/**
 * 刷次徽章：海报角上的锯齿圆章，逆时针斜 30° 贴角。
 *
 * 整枚章都画在 100×100 内切圆里，旋转不会超出视框，
 * 因此外层海报容器的 `overflow-hidden`（圆角卡片要用）不会切掉章体。
 *
 * 贴角方向随 `corner` 翻转：右角是 -30°，左角镜像成 +30°，
 * 章体才会朝卡片内侧倾，否则会像被贴歪了。
 */
function WatchBadge({
  watchIndex,
  corner = "right",
}: {
  watchIndex: number;
  corner?: "left" | "right";
}) {
  const tier = watchBadgeTier(watchIndex);
  if (!tier) return null;
  const numeral = WATCH_BADGE_NUMERALS[watchIndex] ?? "N";
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`第 ${watchIndex} 刷`}
      className={`pointer-events-none absolute top-0 aspect-square w-[32%] ${
        corner === "left" ? "left-0" : "right-0"
      }`}
    >
      <title>{`第 ${watchIndex} 刷`}</title>
      <g transform={`rotate(${corner === "left" ? 30 : -30} 50 50)`}>
        {/*
          章面：齿环直接填成半透明深墨，海报的明暗从底下透上来（参考图那种
          「像透明」的质感就是这么来的），但压得够重，章体在任何海报上都有自己的底。
          真镂空（fill="none"）会让浅色海报直接穿过章面，线条被吃掉，所以不用。
        */}
        <path
          d={CT_TEETH_PATH}
          fill={WATCH_BADGE_FACE_SHADE}
          fillOpacity={WATCH_BADGE_FACE_OPACITY}
          stroke={tier.metal}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {/*
          内外圈刻线走金属亮色：章面已经压深，原来的深墨线会陷进章面消失。
        */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={tier.metal}
          strokeWidth={1.6}
        />
        <circle
          cx="50"
          cy="50"
          r="41.2"
          fill="none"
          stroke={tier.metal}
          strokeWidth={1.1}
        />
        <circle
          cx="50"
          cy="50"
          r="33.8"
          fill="none"
          stroke={tier.metal}
          strokeWidth={1.1}
        />
        {/*
          小星保持实心。星形只有约 4 个 SVG 单位，徽章贴海报 32% 宽时实际不到 2px，
          改成线框会糊成噪点，反而脏。
        */}
        <g fill={tier.metal} opacity={0.82}>
          {CT_TINY_STAR_ANGLES.map((angle) => (
            <path
              key={angle}
              d={CT_STAR_TINY}
              transform={`rotate(${angle} 50 50) translate(50 12.2) scale(0.84)`}
            />
          ))}
        </g>
        <g fill={tier.metal}>
          {CT_BAND_STARS.map((star) => (
            <path
              key={`${star.x}-${star.y}`}
              d={star.mid ? CT_STAR_MID : CT_STAR_BIG}
              transform={`translate(${star.x} ${star.y})`}
            />
          ))}
        </g>
        {/* 文字带两端顶到外环内缘，比只包住文字显得大气。矩形保持实心，作为章面的主体块 */}
        <rect
          x="7.2"
          y="41"
          width="85.6"
          height="18"
          rx="1.5"
          fill={tier.metal}
          stroke={tier.ink}
          strokeWidth={1.1}
        />
        <rect
          x="8.5"
          y="42.3"
          width="83"
          height="15.4"
          rx="0.8"
          fill="none"
          stroke={tier.ink}
          strokeWidth={0.5}
          opacity={0.45}
        />
        {/*
          章面文字拆成两段，故意做大小反差：
          「贰」放到 33 号，字身高出文字带上下边沿，笔锋压在带子上；
          「刷」收到 17 号，稳稳待在带内不咬边框。
          字体也拆开：大字用毛笔楷书，「刷」用页面默认无衬线体并加粗，书法笔锋对印刷粗体。
          两个字各自上移过基线，让整体视觉重心落在圆心 (50,50) 上，而不是偏下。

          大字出框的上下端直接压在章面上：章面是会随海报明暗轻微飘动的半透明深墨，
          所以先在同样的位置画一层更亮的同色系描边当光晕，再叠深墨本体，
          保证笔画在深色海报上也立得住。「刷」在实心带内，不需要。
        */}
        <text
          x="39"
          y="62"
          textAnchor="middle"
          fontSize={33}
          fill={tier.halo}
          stroke={tier.halo}
          strokeWidth={3.2}
          strokeLinejoin="round"
          fontFamily={WATCH_BADGE_NUMERAL_FONT}
        >
          {numeral}
        </text>
        <text
          x="39"
          y="62"
          textAnchor="middle"
          fontSize={33}
          fill={tier.ink}
          fontFamily={WATCH_BADGE_NUMERAL_FONT}
        >
          {numeral}
        </text>
        <text
          x="66"
          y="56.1"
          textAnchor="middle"
          fontSize={17}
          fontWeight={600}
          fill={tier.ink}
        >
          刷
        </text>
      </g>
    </svg>
  );
}

/**
 * 作品卡片。海报走 TMDB 图床，手动录入的作品允许直接填外链，
 * 因此这里用原生 img 而不做域名白名单。
 *
 * 传了 `status` 且为搁置/弃看时，封面上会叠一层降饱和与状态角标；
 * 其他状态（含 null）保持原样，所以档案库那几处调用不受影响。
 *
 * `watchIndex` ≥ 2 时在角上贴一枚刷次徽章；首刷不显示，免得每张海报都挂章。
 * 徽章默认贴右上角，档案库要跟左上角的状态单字错开，因此用 `watchBadgeCorner` 改贴左边。
 */
export function WorkPoster({
  title,
  posterPath,
  className,
  status,
  watchIndex,
  watchBadgeCorner = "right",
}: {
  title: string;
  posterPath: string | null;
  className?: string;
  status?: string | null;
  /** 刷到第几刷，1 或未传时不显示徽章 */
  watchIndex?: number;
  /** 刷次徽章贴哪个角 */
  watchBadgeCorner?: "left" | "right";
}) {
  const src = posterUrl(posterPath);
  const decoration = status ? POSTER_STATUS_STYLES[status] : undefined;
  return (
    <div
      className={`relative aspect-[2/3] w-full overflow-hidden bg-muted ${className ?? ""}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={
            decoration
              ? `${title} 海报（${decoration.label}）`
              : `${title} 海报`
          }
          loading="lazy"
          className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${decoration?.image ?? ""}`}
        />
      ) : (
        <PosterFallback title={title} />
      )}
      {decoration ? (
        <span
          className={`absolute top-1 left-1 inline-flex items-center gap-0.5 rounded-4xl px-1.5 py-0.5 text-[10px] leading-none font-medium ${decoration.badge}`}
        >
          <decoration.icon className="size-2.5" />
          {decoration.label}
        </span>
      ) : null}
      {watchIndex != null ? (
        <WatchBadge watchIndex={watchIndex} corner={watchBadgeCorner} />
      ) : null}
    </div>
  );
}

/** 媒体类型图标：电影用 Film，剧集用 Tv，与详情页的类型行保持一致 */
export function WorkMediaTypeIcon({
  mediaType,
  className,
}: {
  mediaType: string;
  className?: string;
}) {
  const Icon = mediaType === "tv" ? Tv : Film;
  return (
    <Icon role="img" aria-label={mediaTypeLabel(mediaType)} className={className} />
  );
}

/** 作品在列表中的元信息标签行 */
export function WorkMetaBadges({
  date,
  year,
  status,
  country,
  removedCount = 0,
  channel,
  compactStatus = false,
  statusSuffix,
  trailing,
}: {
  /** 最近一次观看日期，列表卡片放在行首 */
  date?: string | null;
  year?: number | null;
  status: string | null;
  /** 制片国家，详情页展示第一个，列表卡片不再展示 */
  country?: string | null;
  /** 「豆瓣已移除」标记的流水条数，0 表示不展示 */
  removedCount?: number;
  /**
   * 最近一次观看的来源渠道。只显示图标不显示文字，鼠标悬停靠 title 补全名称，
   * 图标紧贴状态徽标——两者都描述「这条作品现在怎么样」，摆在一起才好对照。
   */
  channel?: { icon: string | null; color: string | null; label: string | null } | null;
  /**
   * 状态只显示单字（看/追/想/搁/弃）。档案库卡片这一行还要放日期与「豆瓣已移除」，
   * 写全称会把行撑爆；详情页有整行空间，保持全称不动。
   */
  compactStatus?: boolean;
  /**
   * 紧跟在状态徽标右边的补充说明。档案库用它放「至 S1E04」这类进度：
   * 进度脱离状态单独成行时，读者得先看上一行才知道是在说哪部剧的进度，
   * 贴在状态右边才是「这部剧，追到这儿」一句话读完。
   */
  statusSuffix?: ReactNode;
  /** 追加在行尾的内容，详情页用它塞进可交互的来源渠道选择器 */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {date ? <span className="text-xs text-muted-foreground">{date}</span> : null}
      {year ? (
        <span className="text-xs text-muted-foreground">{year}</span>
      ) : null}
      {country ? (
        <span className="truncate text-xs text-muted-foreground">{country}</span>
      ) : null}
      {status ? (
        // 徽标与其后的进度必须待在一起换行，所以状态加后缀合成一个 flex 项；
        // 拆成两个项时，行宽不够会把「至 S1E04」甩到下一行与徽标脱节
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`inline-flex h-5 items-center justify-center rounded-4xl font-medium ${viewStatusTone(status)} ${
              compactStatus ? "w-5 text-xs" : "px-2 text-xs"
            }`}
            title={compactStatus ? viewStatusLabel(status) : undefined}
          >
            {compactStatus ? viewStatusGlyph(status) : viewStatusLabel(status)}
          </span>
          {statusSuffix ? (
            <span className="text-xs text-muted-foreground">{statusSuffix}</span>
          ) : null}
        </span>
      ) : statusSuffix ? (
        // 没有状态徽标时进度仍要能显示，否则零状态的剧会丢掉进度
        <span className="text-xs text-muted-foreground">{statusSuffix}</span>
      ) : null}
      {channel && (channel.icon || channel.color) ? (
        <span
          className="inline-flex items-center"
          title={channel.label ? `来源渠道：${channel.label}` : "来源渠道"}
        >
          <ChannelIcon icon={channel.icon} color={channel.color} />
        </span>
      ) : null}
      {trailing}
      {removedCount > 0 ? (
        // 档案库卡片里占满整行，把「豆瓣已移除」挤到独立一行：它说的是同步状态
        // 而不是这部片子怎么样，混在元信息里容易被误读。详情页一行够宽，
        // 沿旧行为缀在行尾，免得在这一行的宽度上无谓地多占一行
        <span className={compactStatus ? "w-full" : undefined}>
          <span
            className="inline-flex h-5 items-center rounded-4xl bg-amber-500/15 px-2 text-xs font-medium text-amber-400"
            title="最近一次同步时，这些记录已不在豆瓣列表上"
          >
            {DOUBAN_REMOVED_LABEL}
          </span>
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
