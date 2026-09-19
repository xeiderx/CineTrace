import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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
    /** 'matched' 自动匹配成功 | 'manual' 手动指定 | 'pending' 待匹配 | 'failed' 匹配失败 */
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
    /** 'watched' 看过 | 'watching' 在看 | 'wish' 想看 | 'on_hold' 搁置 | 'dropped' 弃剧 */
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

    /* ---- 刷次 ---- */
    /** 第几刷：1 为首刷，2 为二刷 */
    watchIndex: integer("watch_index").notNull().default(1),

    /* ---- 剧集进度：看到第几季第几集 ---- */
    progressSeason: integer("progress_season"),
    progressEpisode: integer("progress_episode"),
    /** 累计已看集数 */
    episodesWatched: integer("episodes_watched"),

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
    index("view_record_status_idx").on(t.status),
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
    /** lucide 图标名，前端映射为图标组件 */
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

/** 作品 × 标签 多对多：一部作品可挂多个标签 */
export const workTag = sqliteTable(
  "work_tag",
  {
    workId: integer("work_id")
      .notNull()
      .references(() => work.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.tagId] }),
    index("work_tag_tag_idx").on(t.tagId),
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
  workTags: many(workTag),
  collectionItems: many(collectionItem),
}));

export const viewRecordRelations = relations(viewRecord, ({ one }) => ({
  work: one(work, { fields: [viewRecord.workId], references: [work.id] }),
  platform: one(platform, {
    fields: [viewRecord.platformId],
    references: [platform.id],
  }),
}));

export const platformRelations = relations(platform, ({ many }) => ({
  viewRecords: many(viewRecord),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  workTags: many(workTag),
}));

export const workTagRelations = relations(workTag, ({ one }) => ({
  work: one(work, { fields: [workTag.workId], references: [work.id] }),
  tag: one(tag, { fields: [workTag.tagId], references: [tag.id] }),
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
export type Platform = typeof platform.$inferSelect;
export type Tag = typeof tag.$inferSelect;
export type Collection = typeof collection.$inferSelect;
export type CollectionItem = typeof collectionItem.$inferSelect;
export type SyncRun = typeof syncRun.$inferSelect;
export type SyncIssue = typeof syncIssue.$inferSelect;
export type Setting = typeof setting.$inferSelect;
export type Person = typeof person.$inferSelect;
