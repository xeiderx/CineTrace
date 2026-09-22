import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

/* -------------------------------------------------------------------------- */
/*                                    用户                                     */
/* -------------------------------------------------------------------------- */

/**
 * 单用户场景：本表恒定只有一行（id = 1）。
 * 保留为独立表而非写死在配置里，是为了后续扩展多用户时不必改表结构。
 */
export const user = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  /** argon2id 哈希，绝不存明文 */
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});

/** 登录会话。token 只存哈希，Cookie 里放原文。 */
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("session_user_idx").on(t.userId),
    index("session_expires_idx").on(t.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                          作品档案（work：实体层）                           */
/* -------------------------------------------------------------------------- */

/**
 * 作品实体：一部电影 / 一部剧本身。
 * 与「观影行为」彻底分离——同一部作品被看三次，这里仍只有一行。
 */
export const work = sqliteTable(
  "work",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** 'movie' | 'tv'，决定 TMDB 接口与季集处理方式 */
    mediaType: text("media_type").notNull(),

    /* ---- 外部标识 ---- */
    /** TMDB 主键。与 mediaType 组成唯一键；手动新建的作品可为空 */
    tmdbId: integer("tmdb_id"),
    /** 豆瓣 subject id。手动新建的作品可为空 */
    doubanId: text("douban_id"),

    /* ---- 元数据 ---- */
    /** 中文名（豆瓣优先，缺则 TMDB zh-CN） */
    title: text("title").notNull(),
    /** 原始名，用于匹配与展示 */
    originalTitle: text("original_title"),
    /**
     * 豆瓣列表页标题里的其余别名（JSON 数组，按豆瓣原序），如
     * ["Toy Story","玩具总动员"] 中除中文名外的部分。
     * 只作匹配留档与排查用，属描述性元数据，不入备份。
     */
    aliasesJson: text("aliases_json").default("[]").notNull(),
    /** 上映/首播年份。剧集记第一季首播年 */
    year: integer("year"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    overview: text("overview"),
    /** 时长（分钟）。电影为片长，剧集为单集时长 */
    runtime: integer("runtime"),
    /** 剧集总季数 */
    seasonCount: integer("season_count"),
    /** 剧集总集数 */
    episodeCount: integer("episode_count"),
    /**
     * 分季结构缓存（TMDB `/tv/{id}.seasons[]` 裁剪版）。
     * 每项含 season_number/name/air_date/episode_count/poster_path/vote_average；
     * 已滤掉 season_number = 0 的特辑。电影为 "[]"。
     */
    seasonsJson: text("seasons_json").default("[]").notNull(),
    /** 首播/上映日期，ISO 文本 */
    releaseDate: text("release_date"),
    /** 外链 */
    imdbId: text("imdb_id"),

    /* ---- 分类（JSON 数组，用 json_each 做统计聚合）---- */
    /** 类型，如 ["剧情","犯罪"]，来自 TMDB 官方分类 */
    genres: text("genres").default("[]").notNull(),
    /** 制片国家/地区，如 ["中国大陆"] */
    countries: text("countries").default("[]").notNull(),
    /** 语言，如 ["普通话"] */
    languages: text("languages").default("[]").notNull(),
    /** 导演，如 ["诺兰"] */
    directors: text("directors").default("[]").notNull(),
    /** 主演（前若干位） */
    cast: text("cast").default("[]").notNull(),

    /* ---- 匹配状态：支撑「手动换绑 / 手动新建」---- */
    /** 'matched' 自动匹配成功 | 'manual' 手动指定 | 'failed' 待匹配（未匹配上 TMDB） */
    matchStatus: text("match_status").notNull().default("pending"),
    /** 匹配依据：'A' 中文名 | 'B' 原名 | 'C' 剧集兜底 | 'manual' */
    matchStrategy: text("match_strategy"),
    /** 最近一次匹配得分，便于排查误匹配 */
    matchScore: integer("match_score"),
    /** 元数据最近一次从 TMDB 刷新的时间 */
    metadataSyncedAt: integer("metadata_synced_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("work_tmdb_uniq").on(t.mediaType, t.tmdbId),
    uniqueIndex("work_douban_uniq").on(t.doubanId),
    index("work_title_idx").on(t.title),
    index("work_year_idx").on(t.year),
    index("work_match_status_idx").on(t.matchStatus),
  ],
);

/* -------------------------------------------------------------------------- */
/*                            人物（演员简介缓存）                              */
/* -------------------------------------------------------------------------- */

/**
 * TMDB 人物简介缓存。`work.cast` 里只存姓名与头像路径，
 * 详细的生平要另调 `/person/{id}` 才有——点了头像才抓，抓过就落这里，
 * 避免同一个演员被反复请求（也避免一次性抓上千个用不上的简介）。
 */
export const person = sqliteTable(
  "person",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** TMDB person id，跨作品复用的键 */
    tmdbPersonId: integer("tmdb_person_id").notNull().unique(),
    name: text("name").notNull(),
    biography: text("biography"),
    birthday: text("birthday"),
    /** 出生地，TMDB 只给英文 */
    placeOfBirth: text("place_of_birth"),
    /** 最近一次拉取时间，便于日后过期刷新 */
    fetchedAt: integer("fetched_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
);

/* -------------------------------------------------------------------------- */
/*                        观影流水（view_record：行为层）                       */
/* -------------------------------------------------------------------------- */

/**
 * 观影记录：看一次 = 一行。
 * 二刷即再插一行，watchIndex 递增，天然支持「二刷三刷」。
 */
export const viewRecord = sqliteTable(
  "view_record",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** 允许为空：豆瓣有条目但尚未匹配上 TMDB 时，记录不能丢 */
    workId: integer("work_id").references(() => work.id, { onDelete: "set null" }),

    /* ---- 来源与幂等 ---- */
    /** 'douban' | 'manual' */
    source: text("source").notNull().default("manual"),
    /** 同步幂等键，形如 `douban:1292052` / `manual:uuid` */
    sourceKey: text("source_key").notNull(),
    /** 豆瓣侧的条目 id，便于回溯 */
    sourceItemId: text("source_item_id"),

    /* ---- 状态 ---- */
    /** 'watched' 看过 | 'watching' 在看 | 'wish' 想看 | 'on_hold' 搁置 | 'dropped' 弃看 */
    status: text("status").notNull().default("watched"),

    /* ---- 时间 ---- */
    /** 标记/看完日期，ISO 文本（YYYY-MM-DD）。月度/年度统计按此分组 */
    watchedAt: text("watched_at"),
    /** 开始观看日期（剧集常用），ISO 文本 */
    startedAt: text("started_at"),
    /** 看完日期，ISO 文本 */
    finishedAt: text("finished_at"),

    /* ---- 评价 ---- */
    /** 1-5 星（豆瓣口径） */
    rating: integer("rating"),
    comment: text("comment"),

    /* ---- 平台：为空表示使用默认平台 ---- */
    platformId: integer("platform_id").references(() => platform.id, {
      onDelete: "set null",
    }),

    /* ---- 来源渠道：这次看的片源是从哪来的，为空表示未指定 ---- */
    /**
     * 注意与上面的 `source` 区分：`source` 表示「这条记录是怎么进来的」
     * （豆瓣同步 / 手工创建），而这里表示「片源来自哪个渠道」。
     */
    sourceChannelId: integer("source_channel_id").references(
      () => sourceChannel.id,
      { onDelete: "set null" },
    ),

    /* ---- 刷次 ---- */
    /** 第几刷：1 为首刷，2 为二刷 */
    watchIndex: integer("watch_index").notNull().default(1),

    /* ---- 剧集进度：看到第几季第几集 ---- */
    /**
     * 豆瓣条目归属的季号。多季剧在豆瓣是一季一个条目，同步时按标题里的季标识
     * 落在这里，详情页据此把每条记录对到对应的季上。
     *
     * 注意它同时承担「归属季」与「看到第几季」两种含义，所以逐集标记
     * （view_episode）不会改写它——否则会把某季的记录挪去别的季。
     */
    progressSeason: integer("progress_season"),
    /**
     * 手动填写的集数进度。逐集标记落地后，真实进度以 view_episode 为准，
     * 这两列只作为「没有逐集数据时」的兜底展示值。
     */
    progressEpisode: integer("progress_episode"),
    /** 手动填写的累计已看集数，同上，作为兜底值 */
    episodesWatched: integer("episodes_watched"),

    /**
     * 被手动改过的字段名（JSON 数组，如 ["rating","watchedAt"]）。
     * 同步遇到这些字段就跳过，不再用豆瓣的值覆盖——「手动改过就不再被同步改回去」。
     * 界面上的「恢复跟随豆瓣」会把这些名字移除，之后的同步重新接管。
     */
    manualFieldsJson: text("manual_fields_json").default("[]").notNull(),

    /* ---- 豆瓣侧变动 ---- */
    /**
     * 豆瓣已移除标记：全量同步跑完时，记录在豆瓣列表里再也看不到的时间。
     * 豆瓣把它删除/合并/转私密后本地记录仍会保留（同步只更新不删除），
     * 打上这个时间戳供界面提示，清理与否由用户自己决定。
     */
    doubanRemovedAt: integer("douban_removed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("view_record_source_key_uniq").on(t.sourceKey),
    index("view_record_work_idx").on(t.workId),
    index("view_record_watched_at_idx").on(t.watchedAt),
    index("view_record_platform_idx").on(t.platformId),
    index("view_record_source_channel_idx").on(t.sourceChannelId),
    index("view_record_status_idx").on(t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/*                            逐集观看明细（追剧）                              */
/* -------------------------------------------------------------------------- */

/**
 * 逐集观看记录：看过的每一集一行。
 *
 * 为什么单独建表而不是把进度继续挤在 view_record 的两个整数列上：
 * 追剧的真实形态是「跳着看」「补看某几集」「一次点完整季」，单个「看到第几集」
 * 表达不了，也算不出某季的确切起止时间。这里一集一行，季进度、整剧进度、
 * 季起止时间全部由它派生。
 *
 * `watchIndex` 与 view_record 同义：二刷时按同一套刷次编号另开一组逐集记录。
 */
export const viewEpisode = sqliteTable(
  "view_episode",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * 所属作品。作品被删除时逐集记录一并清掉（cascade）——
     * 它们是进度的派生数据，脱离作品没有任何意义。
     */
    workId: integer("work_id")
      .notNull()
      .references(() => work.id, { onDelete: "cascade" }),

    /** 第几刷，与 view_record.watchIndex 对应 */
    watchIndex: integer("watch_index").notNull().default(1),

    seasonNumber: integer("season_number").notNull(),
    episodeNumber: integer("episode_number").notNull(),

    /** 该集观看日期，ISO 文本（YYYY-MM-DD）。季/整剧起止时间按此聚合 */
    watchedAt: text("watched_at"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // 同一刷里同一集只有一行，重复标记走 upsert 而非插出多行
    uniqueIndex("view_episode_seat_uniq").on(
      t.workId,
      t.watchIndex,
      t.seasonNumber,
      t.episodeNumber,
    ),
    index("view_episode_work_idx").on(t.workId, t.watchIndex),
  ],
);

/* -------------------------------------------------------------------------- */
/*                              观影平台（自定义）                              */
/* -------------------------------------------------------------------------- */

export const platform = sqliteTable(
  "platform",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    /**
     * 平台图标。两种形态二选一：
     * - lucide 图标名（如 `monitor-play`），前端映射成图标组件；
     * - 图片 data URL（形如 `data:image/png;base64,...`），从图标库或本地上传而来。
     * 前端按前缀区分，见 `PlatformIcon`。
     */
    icon: text("icon"),
    /** 品牌色，如 '#00b020'，用于图表与徽标 */
    color: text("color"),
    /** 是否为默认平台：观影记录未指定平台时落到这里 */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("platform_default_idx").on(t.isDefault)],
);

/* -------------------------------------------------------------------------- */
/*                             来源渠道（两级分类）                             */
/* -------------------------------------------------------------------------- */

/**
 * 片源渠道：这次看的片是从哪来的（流媒体 / PT 站点 / EMBY 服……）。
 *
 * 与 platform 的区别：platform 回答「在哪看的」（客厅电视 / 手机 / 投影），
 * 本表回答「片源哪来」——同一部片可以对在客厅电视上放，片源却是彩虹岛。
 *
 * 层级用单表自引用表达，且**只允许两级**：
 *   parentId IS NULL  → 一级分类，如「PT站点」
 *   parentId 指向一级 → 二级分类，如「彩虹岛」
 * 数据库没法直接约束「只能两级」，故 action 层显式拒绝把二级再挂到二级下。
 *
 * 注意 (parentId, name) 唯一索引拦不住一级分类重名：SQLite 里 NULL 互不相等，
 * 一级分类的重复名要在 action 里显式查一遍。
 */
export const sourceChannel = sqliteTable(
  "source_channel",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** 为空即一级分类；非空则是一级的 id */
    parentId: integer("parent_id").references((): AnySQLiteColumn => sourceChannel.id, {
      onDelete: "cascade",
    }),
    /**
     * 图标图片，整串存 data URL（形如 `data:image/png;base64,...`）。
     * 存库而非落盘：public/ 是 Docker 镜像只读层，容器重建即被覆盖；
     * 存库还能随 JSON 备份一起带走。
     */
    iconData: text("icon_data"),
    /** 标识色，用于徽标与图表 */
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("source_channel_parent_name_uniq").on(t.parentId, t.name),
    index("source_channel_parent_idx").on(t.parentId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                              图标库（外部 JSON）                             */
/* -------------------------------------------------------------------------- */

/**
 * 图标库：一份放在公网的 JSON，里面是一组「图标名 + 图片地址」。
 *
 * 只存地址不存图标：库里动辄几百条图标、总量几十 MB，全量抓下来既慢又没必要；
 * 用户在选图标时按需通过服务端代理取那一张，压缩成 data URL 后落到
 * source_channel.icon_data / platform.icon 里。因此这份 JSON 挂掉也不影响已选图标。
 *
 * 图片地址指向 raw.githubusercontent.com 之类的外网，浏览器直连常被墙，
 * 故取 JSON 与取图都走服务端代理（见 /api/icon-libraries）。
 */
export const iconLibrary = sqliteTable(
  "icon_library",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 展示名，列表里用来选库 */
    name: text("name").notNull().unique(),
    /** 图标库 JSON 的地址 */
    url: text("url").notNull().unique(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("icon_library_sort_idx").on(t.sortOrder)],
);

/* -------------------------------------------------------------------------- */
/*                                标签（自定义）                                */
/* -------------------------------------------------------------------------- */

/** 用户自定义标签，如「想看第二遍」「陪家人看」「影院体验」 */
export const tag = sqliteTable(
  "tag",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("tag_name_idx").on(t.name)],
);

/**
 * 观影流水 × 标签 多对多：一次观看可挂多个标签。
 *
 * 为什么挂在这里而不是作品上：同一部片一刷觉得「剧情不错」、二刷觉得「不好看」，
 * 两个判断属于不同的观看行为，挂在作品上会混成一堆互相矛盾的标签。
 * 挂到流水后，每条记录只表达「这一次」的感受。
 *
 * 注意 view_record.workId 是可空且 onDelete: set null 的，所以作品被删除时
 * 流水仍在、标签也跟着流水保留，语义正常。
 */
export const viewRecordTag = sqliteTable(
  "view_record_tag",
  {
    viewRecordId: integer("view_record_id")
      .notNull()
      .references(() => viewRecord.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.viewRecordId, t.tagId] }),
    index("view_record_tag_tag_idx").on(t.tagId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                              片单（纯本地自建）                              */
/* -------------------------------------------------------------------------- */

export const collection = sqliteTable(
  "collection",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    description: text("description"),
    /** 封面：可指定某部作品的海报，也可单独上传 */
    coverPath: text("cover_path"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (t) => [index("collection_sort_idx").on(t.sortOrder)],
);

/** 片单 × 作品。允许同一部作品进多个片单；片单内可手动排序 */
export const collectionItem = sqliteTable(
  "collection_item",
  {
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    workId: integer("work_id")
      .notNull()
      .references(() => work.id, { onDelete: "cascade" }),
    /** 片单内自定义排序，越小越靠前 */
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.workId] }),
    index("collection_item_work_idx").on(t.workId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                              同步任务与运维                                  */
/* -------------------------------------------------------------------------- */

/** 任务锁落库而非内存：web 与 worker 是两个容器，内存锁不互通 */
export const taskLock = sqliteTable("task_lock", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  acquiredAt: integer("acquired_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

/** 每次同步的批次记录，用于排查与展示同步历史 */
export const syncRun = sqliteTable(
  "sync_run",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 'douban-html' | 'douban-rss' | 'tmdb-metadata' | 'backfill' */
    kind: text("kind").notNull(),
    /** 'running' | 'success' | 'partial' | 'failed' */
    status: text("status").notNull().default("running"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    cursor: text("cursor"),
    itemsSeen: integer("items_seen").notNull().default(0),
    itemsNew: integer("items_new").notNull().default(0),
    itemsUpdated: integer("items_updated").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    message: text("message"),
  },
  (t) => [index("sync_run_kind_idx").on(t.kind, t.startedAt)],
);

/**
 * 原始响应归档索引。原始报文以 gzip 落盘（NAS 本地卷），
 * 数据库只存元信息——豆瓣改版后可零请求重解析。
 */
export const rawArchive = sqliteTable(
  "raw_archive",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 请求 URL 的 sha256，用于去重 */
    urlHash: text("url_hash").notNull(),
    url: text("url").notNull(),
    /** 'list' | 'detail' | 'rss' | 'tmdb' */
    kind: text("kind").notNull(),
    /** 落盘相对路径 */
    path: text("path").notNull(),
    /** 解析器版本号，改版后据此筛选需重解析的归档 */
    parserVersion: text("parser_version").notNull(),
    sizeBytes: integer("size_bytes"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("raw_archive_url_hash_uniq").on(t.urlHash, t.parserVersion),
    index("raw_archive_kind_idx").on(t.kind, t.fetchedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                应用设置                                     */
/* -------------------------------------------------------------------------- */

/** 键值配置：豆瓣 UID、默认平台、同步开关、TMDB 语言等 */
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  /** JSON 编码，便于存对象与数组 */
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});

/** 刮削/同步过程中产生的可复现错误，便于在 UI 里提示与手动重试 */
export const syncIssue = sqliteTable(
  "sync_issue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    /** 关联的豆瓣条目或作品 */
    refId: text("ref_id"),
    title: text("title"),
    /** 'no_match' | 'low_score' | 'network' | 'parse' | 'blocked' */
    reason: text("reason").notNull(),
    detail: text("detail"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("sync_issue_reason_idx").on(t.reason, t.resolvedAt)],
);

/* -------------------------------------------------------------------------- */
/*                                  关系定义                                   */
/* -------------------------------------------------------------------------- */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const workRelations = relations(work, ({ many }) => ({
  viewRecords: many(viewRecord),
  viewEpisodes: many(viewEpisode),
  collectionItems: many(collectionItem),
}));

export const viewEpisodeRelations = relations(viewEpisode, ({ one }) => ({
  work: one(work, { fields: [viewEpisode.workId], references: [work.id] }),
}));

export const viewRecordRelations = relations(viewRecord, ({ one, many }) => ({
  work: one(work, { fields: [viewRecord.workId], references: [work.id] }),
  platform: one(platform, {
    fields: [viewRecord.platformId],
    references: [platform.id],
  }),
  sourceChannel: one(sourceChannel, {
    fields: [viewRecord.sourceChannelId],
    references: [sourceChannel.id],
  }),
  viewRecordTags: many(viewRecordTag),
}));

export const platformRelations = relations(platform, ({ many }) => ({
  viewRecords: many(viewRecord),
}));

export const sourceChannelRelations = relations(sourceChannel, ({ one, many }) => ({
  parent: one(sourceChannel, {
    fields: [sourceChannel.parentId],
    references: [sourceChannel.id],
    relationName: "sourceChannelHierarchy",
  }),
  children: many(sourceChannel, { relationName: "sourceChannelHierarchy" }),
  viewRecords: many(viewRecord),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  viewRecordTags: many(viewRecordTag),
}));

export const viewRecordTagRelations = relations(viewRecordTag, ({ one }) => ({
  viewRecord: one(viewRecord, {
    fields: [viewRecordTag.viewRecordId],
    references: [viewRecord.id],
  }),
  tag: one(tag, { fields: [viewRecordTag.tagId], references: [tag.id] }),
}));

export const collectionRelations = relations(collection, ({ many }) => ({
  items: many(collectionItem),
}));

export const collectionItemRelations = relations(collectionItem, ({ one }) => ({
  collection: one(collection, {
    fields: [collectionItem.collectionId],
    references: [collection.id],
  }),
  work: one(work, {
    fields: [collectionItem.workId],
    references: [work.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/*                                  类型导出                                   */
/* -------------------------------------------------------------------------- */

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Work = typeof work.$inferSelect;
export type NewWork = typeof work.$inferInsert;
export type ViewRecord = typeof viewRecord.$inferSelect;
export type NewViewRecord = typeof viewRecord.$inferInsert;
export type ViewEpisode = typeof viewEpisode.$inferSelect;
export type NewViewEpisode = typeof viewEpisode.$inferInsert;
export type Platform = typeof platform.$inferSelect;
export type SourceChannel = typeof sourceChannel.$inferSelect;
export type NewSourceChannel = typeof sourceChannel.$inferInsert;
export type IconLibrary = typeof iconLibrary.$inferSelect;
export type NewIconLibrary = typeof iconLibrary.$inferInsert;
export type Tag = typeof tag.$inferSelect;
export type Collection = typeof collection.$inferSelect;
export type CollectionItem = typeof collectionItem.$inferSelect;
export type SyncRun = typeof syncRun.$inferSelect;
export type SyncIssue = typeof syncIssue.$inferSelect;
export type Setting = typeof setting.$inferSelect;
export type Person = typeof person.$inferSelect;
