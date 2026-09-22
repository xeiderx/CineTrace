import { and, count, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  collection,
  collectionItem,
  iconLibrary,
  platform,
  setting,
  sourceChannel,
  tag,
  user,
  viewEpisode,
  viewRecord,
  viewRecordTag,
  work,
  type NewWork,
} from "@/db/schema";
import { APP_VERSION } from "@/lib/version";

/**
 * 备份与恢复。
 *
 * 只备份「用户自己的数据」——观影记录、作品的身份标识（豆瓣/TMDB id）、
 * 平台、来源渠道、标签、片单、设置与账号。作品的描述性元数据（海报、简介、时长、
 * 分季结构等）刻意不备份：它们随时可以从 TMDB 重新拉取，且会过期，
 * 放进备份只会让文件臃肿。导入后按需用「补全元数据」按钮回填。
 */

export const BACKUP_FORMAT = "cinetrace-backup";
/**
 * 备份格式版本。
 * v2：标签挂载层级从「作品」下沉到「观影流水」，`workTags` 变为 `viewRecordTags`
 * （以 viewRecord 的 sourceKey 关联）。导入 v1 文件时会把作品级标签折算到
 * 该作品最新一条流水上，口径与迁移 0006 的存量回填一致。
 * v3：新增来源渠道（`sourceChannels`），观影流水用 `sourceChannelName` +
 * `sourceChannelParentName` 指向它。v2 及更早的文件没有这两段，
 * 按「未指定来源渠道」处理。渠道图标也一并备份：它只存在数据库里。
 * v4：新增图标库（`iconLibraries`），平台与渠道从图标库选的图会在选定时
 * 就压成 data URL 存进各自表里，因此这里只需要带上库名与地址。
 * v3 及更早的文件没有这一段，导入后图标库为空，用户可在设置里补。
 */
export const BACKUP_VERSION = 4;

/**
 * work 的身份与匹配层。海报、简介、时长、分季结构等描述性字段不入备份——
 * 它们随时能从 TMDB 重拉且会过期，导入后用「补全元数据」按钮回填即可。
 */
export type BackupWork = {
  mediaType: string;
  tmdbId: number | null;
  doubanId: string | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  matchStatus: string;
  matchStrategy: string | null;
  matchScore: number | null;
};

export type BackupViewRecord = {
  sourceKey: string;
  workKey: string | null;
  source: string;
  sourceItemId: string | null;
  status: string;
  watchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  comment: string | null;
  platformName: string | null;
  watchIndex: number;
  progressSeason: number | null;
  progressEpisode: number | null;
  episodesWatched: number | null;
  /** 「豆瓣已移除」标记时间，ISO 字符串。老备份文件没有这个字段，按未标记处理 */
  doubanRemovedAt: string | null;
  /**
   * 被手动改过、不再跟随豆瓣同步的字段名（JSON 数组文本）。
   * 老备份文件没有这个字段，按「无锁定」处理，导入后同步会重新接管全部字段。
   */
  manualFieldsJson: string | null;
  /**
   * v3 起：这条流水的来源渠道名。一级分类名填在这里，二级时还带 parentName。
   * v2 及更早的备份没有这两个字段，导入后为「未指定来源渠道」。
   */
  sourceChannelName?: string | null;
  /** v3 起：所选渠道的上级一级分类名；选中的本身就是一级时为 null */
  sourceChannelParentName?: string | null;
};

/**
 * 来源渠道。层级用「一级名 → 二级名」的父子名表达，
 * 二级名只在同一个一级下唯一（如「PT站点 › 天空」与「EMBY服 › 天空」是两条）。
 * 图标是 data URL，只存在数据库里，因此连同备份一起走。
 */
export type BackupSourceChannel = {
  name: string;
  /** 上级一级分类名；为空即一级分类本身 */
  parentName: string | null;
  iconData: string | null;
  color: string | null;
  sortOrder: number;
};

/**
 * 逐集观看明细。`workId` 在库里是 notNull + cascade，
 * 所以这里用 `workKey` 承载作品引用，解析不到就跳过该行（不造孤儿记录）。
 */
export type BackupViewEpisode = {
  workKey: string;
  watchIndex: number;
  seasonNumber: number;
  episodeNumber: number;
  /** 该集观看日期，ISO 文本（YYYY-MM-DD） */
  watchedAt: string | null;
};

/**
 * 图标库。只存名字与地址：图标本身在选定时已压成 data URL 落到平台/渠道表里，
 * 备份它们没有意义（远端库随时可以重拉）。
 */
export type BackupIconLibrary = {
  name: string;
  url: string;
  sortOrder: number;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  exportedAt: string;
  data: {
    users: { username: string; passwordHash: string; displayName: string | null }[];
    settings: { key: string; value: string }[];
    platforms: { name: string; icon: string | null; color: string | null; isDefault: boolean; sortOrder: number }[];
    /** v3 起：来源渠道两级树，图标以 data URL 原样带上 */
    sourceChannels: BackupSourceChannel[];
    /** v4 起：图标库清单，只有名字与地址 */
    iconLibraries: BackupIconLibrary[];
    tags: { name: string; color: string | null }[];
    works: BackupWork[];
    viewRecords: BackupViewRecord[];
    viewEpisodes: BackupViewEpisode[];
    /**
     * v2 起：标签挂在观影流水上，用 flow 的 sourceKey 关联。
     * 二刷三刷各自带自己的标签，不再像 v1 那样把标签挂在作品上。
     */
    viewRecordTags: { sourceKey: string; tagName: string }[];
    /**
     * v1 遗留字段：标签挂在作品上。只在导入 v1 备份时读取，
     * 折算到该作品最新一条流水（口径与迁移 0006 的存量回填一致）。
     * 导出时不再写入。
     */
    workTags?: { workKey: string; tagName: string }[];
    collections: { name: string; description: string | null; coverPath: string | null; sortOrder: number }[];
    collectionItems: { collectionName: string; workKey: string; sortOrder: number; note: string | null }[];
  };
};

export type ImportStats = {
  users: number;
  settings: number;
  platforms: number;
  sourceChannels: number;
  iconLibraries: number;
  tags: number;
  works: number;
  viewRecords: number;
  viewEpisodes: number;
  viewRecordTags: number;
  collections: number;
  collectionItems: number;
};

/**
 * 备份里的时间字段统一用 ISO 字符串，读到脏值或缺失一律当未标记，
 * 免得一份手改过的备份文件把导入整个搞挂。
 */
function parseBackupDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** work 在备份文件内的稳定引用键：优先 TMDB，其次豆瓣，最后标题+年份。 */
function workKeyOf(row: {
  mediaType: string;
  tmdbId: number | null;
  doubanId: string | null;
  title: string;
  year: number | null;
}): string {
  if (row.tmdbId != null) return `tmdb:${row.mediaType}:${row.tmdbId}`;
  if (row.doubanId) return `douban:${row.doubanId}`;
  return `local:${row.mediaType}:${row.title}:${row.year ?? ""}`;
}

/* -------------------------------------------------------------------------- */
/*                                    导出                                     */
/* -------------------------------------------------------------------------- */

export function exportBackup(): BackupFile {
  const workRows = db
    .select({
      id: work.id,
      mediaType: work.mediaType,
      tmdbId: work.tmdbId,
      doubanId: work.doubanId,
      title: work.title,
      originalTitle: work.originalTitle,
      year: work.year,
      matchStatus: work.matchStatus,
      matchStrategy: work.matchStrategy,
      matchScore: work.matchScore,
    })
    .from(work)
    .all();

  const workIdToKey = new Map<number, string>();
  const works: BackupWork[] = workRows.map((row) => {
    workIdToKey.set(row.id, workKeyOf(row));
    return {
      mediaType: row.mediaType,
      tmdbId: row.tmdbId,
      doubanId: row.doubanId,
      title: row.title,
      originalTitle: row.originalTitle,
      year: row.year,
      matchStatus: row.matchStatus,
      matchStrategy: row.matchStrategy,
      matchScore: row.matchScore,
    };
  });

  const platformIdToName = new Map<number, string>();
  for (const row of db.select({ id: platform.id, name: platform.name }).from(platform).all()) {
    platformIdToName.set(row.id, row.name);
  }

  /*
   * 来源渠道：一次性读出来，既建 id → 记录 的映射供流水引用，
   * 也用来把 parentId 翻成一级分类名（备份里不落自增 id）。
   */
  const channelRows = db.select().from(sourceChannel).all();
  const channelById = new Map(channelRows.map((row) => [row.id, row]));
  /** 渠道 id → 「一级名 / 二级名」。一级分类的 parentName 为 null */
  const channelPathById = new Map<number, { name: string; parentName: string | null }>();
  for (const row of channelRows) {
    channelPathById.set(row.id, {
      name: row.name,
      parentName:
        row.parentId != null ? channelById.get(row.parentId)?.name ?? null : null,
    });
  }
  const sourceChannels: BackupSourceChannel[] = channelRows.map((row) => ({
    name: row.name,
    parentName: channelPathById.get(row.id)?.parentName ?? null,
    iconData: row.iconData,
    color: row.color,
    sortOrder: row.sortOrder,
  }));

  const tagIdToName = new Map<number, string>();
  for (const row of db.select({ id: tag.id, name: tag.name }).from(tag).all()) {
    tagIdToName.set(row.id, row.name);
  }

  const collectionIdToName = new Map<number, string>();
  for (const row of db.select({ id: collection.id, name: collection.name }).from(collection).all()) {
    collectionIdToName.set(row.id, row.name);
  }

  const viewRecords: BackupViewRecord[] = db
    .select()
    .from(viewRecord)
    .all()
    .map((row) => ({
      sourceKey: row.sourceKey,
      workKey: row.workId != null ? workIdToKey.get(row.workId) ?? null : null,
      source: row.source,
      sourceItemId: row.sourceItemId,
      status: row.status,
      watchedAt: row.watchedAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      rating: row.rating,
      comment: row.comment,
      platformName: row.platformId != null ? platformIdToName.get(row.platformId) ?? null : null,
      watchIndex: row.watchIndex,
      progressSeason: row.progressSeason,
      progressEpisode: row.progressEpisode,
      episodesWatched: row.episodesWatched,
      doubanRemovedAt: row.doubanRemovedAt?.toISOString() ?? null,
      manualFieldsJson: row.manualFieldsJson,
      sourceChannelName:
        row.sourceChannelId != null
          ? channelPathById.get(row.sourceChannelId)?.name ?? null
          : null,
      sourceChannelParentName:
        row.sourceChannelId != null
          ? channelPathById.get(row.sourceChannelId)?.parentName ?? null
          : null,
    }));

  /*
   * 逐集明细：作品的 notNull 外键换成语义化的 workKey。
   * 取不到键（理论上不会发生）就丢掉该行，宁可少备份也不要留下无法归属的记录。
   */
  const viewEpisodes: BackupViewEpisode[] = db
    .select()
    .from(viewEpisode)
    .all()
    .map((row) => ({
      workKey: workIdToKey.get(row.workId) ?? "",
      watchIndex: row.watchIndex,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      watchedAt: row.watchedAt,
    }))
    .filter((row) => row.workKey);

  /*
   * 流水标签：标签挂在观影流水上，用流水的 sourceKey 关联
   * （sourceKey 在导入侧是幂等键，比自增 id 稳定）。
   * 解析不到流水或标签的行直接丢弃，避免备份里出现无法归属的关联。
   */
  const viewRecordTags = db
    .select({ sourceKey: viewRecord.sourceKey, tagId: viewRecordTag.tagId })
    .from(viewRecordTag)
    .innerJoin(viewRecord, eq(viewRecordTag.viewRecordId, viewRecord.id))
    .all()
    .map((row) => ({ sourceKey: row.sourceKey, tagName: tagIdToName.get(row.tagId) ?? "" }))
    .filter((row) => row.sourceKey && row.tagName);

  const collectionItems = db
    .select()
    .from(collectionItem)
    .all()
    .map((row) => ({
      collectionName: collectionIdToName.get(row.collectionId) ?? "",
      workKey: workIdToKey.get(row.workId) ?? "",
      sortOrder: row.sortOrder,
      note: row.note,
    }))
    .filter((row) => row.collectionName && row.workKey);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      // 账号连同密码哈希一起备份，导入到新机器后可直接登录
      users: db
        .select({ username: user.username, passwordHash: user.passwordHash, displayName: user.displayName })
        .from(user)
        .all(),
      settings: db.select({ key: setting.key, value: setting.value }).from(setting).all(),
      platforms: db
        .select({
          name: platform.name,
          icon: platform.icon,
          color: platform.color,
          isDefault: platform.isDefault,
          sortOrder: platform.sortOrder,
        })
        .from(platform)
        .all(),
      tags: db.select({ name: tag.name, color: tag.color }).from(tag).all(),
      sourceChannels,
      iconLibraries: db
        .select({ name: iconLibrary.name, url: iconLibrary.url, sortOrder: iconLibrary.sortOrder })
        .from(iconLibrary)
        .all(),
      works,
      viewRecords,
      viewEpisodes,
      viewRecordTags,
      collections: db
        .select({
          name: collection.name,
          description: collection.description,
          coverPath: collection.coverPath,
          sortOrder: collection.sortOrder,
        })
        .from(collection)
        .all(),
      collectionItems,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                                    导入                                     */
/* -------------------------------------------------------------------------- */

/** 结构校验：只认自家格式，字段缺失即视为损坏文件，不做逐字段强制。 */
export function parseBackupFile(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("文件不是合法的 JSON");
  }
  const file = parsed as Partial<BackupFile>;
  if (file?.format !== BACKUP_FORMAT) throw new Error("不是 CineTrace 备份文件");
  if (typeof file.version !== "number") throw new Error("备份文件缺少版本号");
  if (file.version > BACKUP_VERSION) {
    throw new Error(`备份文件版本 v${file.version} 高于当前支持的 v${BACKUP_VERSION}，请先升级应用`);
  }
  const data = file.data;
  if (!data || !Array.isArray(data.works) || !Array.isArray(data.viewRecords)) {
    throw new Error("备份文件内容不完整");
  }
  return {
    format: BACKUP_FORMAT,
    version: file.version,
    appVersion: file.appVersion ?? "unknown",
    exportedAt: file.exportedAt ?? "",
    data: {
      users: data.users ?? [],
      settings: data.settings ?? [],
      platforms: data.platforms ?? [],
      /* v2 及更早的备份没有这一段，导入后来源渠道为空 */
      sourceChannels: data.sourceChannels ?? [],
      /* v3 及更早的备份没有这一段，导入后图标库为空，用户可在设置里补 */
      iconLibraries: data.iconLibraries ?? [],
      tags: data.tags ?? [],
      works: data.works,
      viewRecords: data.viewRecords,
      viewEpisodes: data.viewEpisodes ?? [],
      viewRecordTags: data.viewRecordTags ?? [],
      /* v1 老文件才有：导入时折算到该作品最新一条流水 */
      workTags: data.workTags ?? [],
      collections: data.collections ?? [],
      collectionItems: data.collectionItems ?? [],
    },
  };
}

/**
 * 合并导入：全程 upsert，已存在的按业务唯一键更新，不存在的新建。
 * 不删任何现有数据，重复导入同一份文件结果一致。
 */
export function importBackup(file: BackupFile): ImportStats {
  const d = file.data;
  const stats: ImportStats = {
    users: 0,
    settings: 0,
    platforms: 0,
    sourceChannels: 0,
    iconLibraries: 0,
    tags: 0,
    works: 0,
    viewRecords: 0,
    viewEpisodes: 0,
    viewRecordTags: 0,
    collections: 0,
    collectionItems: 0,
  };

  return db.transaction((tx) => {
    /* 账号：按 username upsert。同名用户会被备份里的密码哈希覆盖。 */
    for (const row of d.users) {
      if (!row?.username) continue;
      tx.insert(user)
        .values({ username: row.username, passwordHash: row.passwordHash, displayName: row.displayName ?? null })
        .onConflictDoUpdate({
          target: user.username,
          set: { passwordHash: row.passwordHash, displayName: row.displayName ?? null, updatedAt: new Date() },
        })
        .run();
      stats.users += 1;
    }

    /*
     * 设置：按 key 覆盖，但备份里的空值不覆盖本地已有值。
     * 否则「导出 → 导入」会把本地刚填好的 TMDB API Key 之类冲回空字符串。
     * 本地缺该 key 时仍补一条空值，保持设置项齐全。
     */
    for (const row of d.settings) {
      if (!row?.key) continue;
      const value = row.value ?? "";
      const insert = tx.insert(setting).values({ key: row.key, value });
      if (value === "") {
        // 空值只用于补齐缺失的 key，不覆盖本地已有值
        insert.onConflictDoNothing({ target: setting.key }).run();
      } else {
        insert
          .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt: new Date() } })
          .run();
      }
      stats.settings += 1;
    }

    /* 平台：按 name upsert，并记录名字 → 新 id 映射 */
    const platformIdByName = new Map<string, number>();
    for (const row of d.platforms) {
      if (!row?.name) continue;
      const saved = tx
        .insert(platform)
        .values({
          name: row.name,
          icon: row.icon ?? null,
          color: row.color ?? null,
          isDefault: row.isDefault ?? false,
          sortOrder: row.sortOrder ?? 0,
        })
        .onConflictDoUpdate({
          target: platform.name,
          set: { icon: row.icon ?? null, color: row.color ?? null, isDefault: row.isDefault ?? false, sortOrder: row.sortOrder ?? 0 },
        })
        .returning({ id: platform.id })
        .get();
      platformIdByName.set(row.name, saved.id);
      stats.platforms += 1;
    }
    for (const row of tx.select({ name: platform.name, id: platform.id }).from(platform).all()) {
      if (!platformIdByName.has(row.name)) platformIdByName.set(row.name, row.id);
    }

    /*
     * 来源渠道：层级用父子名表达，因此要「先一级、后二级」处理，
     * 否则二级找不到父级。引用键是「父级名 + 名字」，二级同名可以存在于不同一级下。
     *
     * (parentId, name) 唯一索引在 SQLite 里拦不住一级重名（NULL 互不相等），
     * upsert 也没有可用的冲突目标，所以按父级 + 名字显式查一遍：
     * 已存在就更新（图标、颜色、排序跟着备份走），不存在才插入。
     */
    const channelKeyOf = (parentName: string | null, name: string) =>
      `${parentName ?? ""}\u0000${name}`;
    const channelIdByKey = new Map<string, number>();

    // 已有渠道先登记进映射，导入条目才能与之合并而不是插重
    const existingChannels = tx.select().from(sourceChannel).all();
    const existingChannelNameById = new Map(
      existingChannels.map((row) => [row.id, row.name]),
    );
    for (const row of existingChannels) {
      const parentName =
        row.parentId != null ? existingChannelNameById.get(row.parentId) ?? null : null;
      channelIdByKey.set(channelKeyOf(parentName, row.name), row.id);
    }

    const orderedChannels = [
      ...d.sourceChannels.filter((row) => !row?.parentName),
      ...d.sourceChannels.filter((row) => row?.parentName),
    ];

    for (const row of orderedChannels) {
      const name = row?.name?.trim();
      if (!name) continue;

      const parentName = row.parentName?.trim() || null;
      const parentId = parentName
        ? channelIdByKey.get(channelKeyOf(null, parentName)) ?? null
        : null;
      // 二级找不到对应的一级分类就跳过，不造无所归属的孤儿渠道
      if (parentName && parentId == null) continue;

      const values = {
        name,
        parentId,
        iconData: row.iconData ?? null,
        color: row.color ?? null,
        sortOrder: row.sortOrder ?? 0,
      };

      const key = channelKeyOf(parentName, name);
      const existingId = channelIdByKey.get(key);
      if (existingId != null) {
        tx.update(sourceChannel).set(values).where(eq(sourceChannel.id, existingId)).run();
      } else {
        const saved = tx
          .insert(sourceChannel)
          .values(values)
          .returning({ id: sourceChannel.id })
          .get();
        channelIdByKey.set(key, saved.id);
      }
      stats.sourceChannels += 1;
    }

    /*
     * 图标库：name 与 url 都是唯一索引，单靠 name 做 upsert 会在
     * 「本地改过名字、地址没变」时撞 url 唯一约束，所以按 name 或 url 查一遍：
     * 命中就更新（名字、地址、排序都跟着备份走），没有才插入。
     */
    for (const row of d.iconLibraries) {
      const name = row?.name?.trim();
      const url = row?.url?.trim();
      if (!name || !url) continue;
      const existing = tx
        .select({ id: iconLibrary.id })
        .from(iconLibrary)
        .where(or(eq(iconLibrary.name, name), eq(iconLibrary.url, url)))
        .get();
      const values = { name, url, sortOrder: row.sortOrder ?? 0 };
      if (existing) {
        tx.update(iconLibrary).set(values).where(eq(iconLibrary.id, existing.id)).run();
      } else {
        tx.insert(iconLibrary).values(values).run();
      }
      stats.iconLibraries += 1;
    }

    /* 标签 / 片单：同样按 name upsert */
    const tagIdByName = new Map<string, number>();
    for (const row of d.tags) {
      if (!row?.name) continue;
      const saved = tx
        .insert(tag)
        .values({ name: row.name, color: row.color ?? null })
        .onConflictDoUpdate({ target: tag.name, set: { color: row.color ?? null } })
        .returning({ id: tag.id })
        .get();
      tagIdByName.set(row.name, saved.id);
      stats.tags += 1;
    }
    for (const row of tx.select({ name: tag.name, id: tag.id }).from(tag).all()) {
      if (!tagIdByName.has(row.name)) tagIdByName.set(row.name, row.id);
    }

    const collectionIdByName = new Map<string, number>();
    for (const row of d.collections) {
      if (!row?.name) continue;
      const saved = tx
        .insert(collection)
        .values({
          name: row.name,
          description: row.description ?? null,
          coverPath: row.coverPath ?? null,
          sortOrder: row.sortOrder ?? 0,
        })
        .onConflictDoUpdate({
          target: collection.name,
          set: { description: row.description ?? null, coverPath: row.coverPath ?? null, sortOrder: row.sortOrder ?? 0, updatedAt: new Date() },
        })
        .returning({ id: collection.id })
        .get();
      collectionIdByName.set(row.name, saved.id);
      stats.collections += 1;
    }
    for (const row of tx.select({ name: collection.name, id: collection.id }).from(collection).all()) {
      if (!collectionIdByName.has(row.name)) collectionIdByName.set(row.name, row.id);
    }

    /*
     * 作品：复用与同步任务一致的归属顺序——先按 (mediaType, tmdbId)，
     * 再按 doubanId，都没有才新建。这样导入不会与已有数据撞唯一索引，
     * 也保留用户手动换绑（matchStatus='manual'）的结果。
     */
    const workIdByKey = new Map<string, number>();
    const remember = (key: string, id: number) => {
      if (!workIdByKey.has(key)) workIdByKey.set(key, id);
    };

    // 已有作品先建立「引用键 → id」索引，导入条目才能与之合并
    for (const row of tx
      .select({ id: work.id, mediaType: work.mediaType, tmdbId: work.tmdbId, doubanId: work.doubanId, title: work.title, year: work.year })
      .from(work)
      .all()) {
      remember(workKeyOf(row), row.id);
    }

    for (const row of d.works) {
      if (!row?.title) continue;
      const values: NewWork = {
        mediaType: row.mediaType ?? "movie",
        tmdbId: row.tmdbId ?? null,
        doubanId: row.doubanId ?? null,
        title: row.title,
        originalTitle: row.originalTitle ?? null,
        year: row.year ?? null,
        matchStatus: row.matchStatus ?? "failed",
        matchStrategy: row.matchStrategy ?? null,
        matchScore: row.matchScore ?? null,
      };

      const byTmdb =
        values.tmdbId != null
          ? tx
              .select({ id: work.id, doubanId: work.doubanId })
              .from(work)
              .where(and(eq(work.mediaType, values.mediaType), eq(work.tmdbId, values.tmdbId)))
              .get()
          : undefined;
      const byDouban = values.doubanId
        ? tx.select({ id: work.id, doubanId: work.doubanId }).from(work).where(eq(work.doubanId, values.doubanId)).get()
        : undefined;
      const existing = byTmdb ?? byDouban;

      if (existing) {
        // doubanId 是唯一索引，沿用库中已有的代表值避免冲突
        tx.update(work)
          .set({ ...values, doubanId: existing.doubanId ?? values.doubanId, updatedAt: new Date() })
          .where(eq(work.id, existing.id))
          .run();
        remember(workKeyOf({ ...row, mediaType: values.mediaType }), existing.id);
      } else {
        const inserted = tx.insert(work).values(values).returning({ id: work.id }).get();
        remember(workKeyOf({ ...row, mediaType: values.mediaType }), inserted.id);
      }
      stats.works += 1;
    }

    /* 观影记录：sourceKey 是天然幂等键 */
    const viewRecordIdBySourceKey = new Map<string, number>();

    for (const row of d.viewRecords) {
      if (!row?.sourceKey) continue;
      const workId = row.workKey ? workIdByKey.get(row.workKey) ?? null : null;
      const platformId = row.platformName ? platformIdByName.get(row.platformName) ?? null : null;
      const values = {
        workId,
        platformId,
        source: row.source ?? "manual",
        sourceItemId: row.sourceItemId ?? null,
        status: row.status ?? "watched",
        watchedAt: row.watchedAt ?? null,
        startedAt: row.startedAt ?? null,
        finishedAt: row.finishedAt ?? null,
        rating: row.rating ?? null,
        comment: row.comment ?? null,
        watchIndex: row.watchIndex ?? 1,
        progressSeason: row.progressSeason ?? null,
        progressEpisode: row.progressEpisode ?? null,
        episodesWatched: row.episodesWatched ?? null,
        // 老备份文件没有这个字段：按未标记处理，不会凭空造出「豆瓣已移除」
        doubanRemovedAt: parseBackupDate(row.doubanRemovedAt),
        // 该列 notNull，缺省补空数组：老备份导入后同步会重新接管全部字段
        manualFieldsJson: typeof row.manualFieldsJson === "string" && row.manualFieldsJson.trim()
          ? row.manualFieldsJson
          : "[]",
      };
      const saved = tx
        .insert(viewRecord)
        .values({ ...values, sourceKey: row.sourceKey })
        .onConflictDoUpdate({ target: viewRecord.sourceKey, set: { ...values, updatedAt: new Date() } })
        .returning({ id: viewRecord.id })
        .get();
      viewRecordIdBySourceKey.set(row.sourceKey, saved.id);
      stats.viewRecords += 1;
    }

    /*
     * 逐集明细：唯一键是 (workId, watchIndex, seasonNumber, episodeNumber)，
     * 重复导入同一份文件走 upsert 而非插重。
     * workKey 解析不到对应作品时跳过——workId 不能为空，造不出合法行。
     */
    for (const row of d.viewEpisodes) {
      if (!row?.workKey) continue;
      const workId = workIdByKey.get(row.workKey);
      if (!workId) continue;
      const seasonNumber = row.seasonNumber;
      const episodeNumber = row.episodeNumber;
      // 季/集号是必填的定位信息，缺失或非数字的脏数据直接丢弃
      if (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)) continue;
      const watchIndex = Number.isInteger(row.watchIndex) ? row.watchIndex : 1;
      const values = { watchedAt: row.watchedAt ?? null };
      tx.insert(viewEpisode)
        .values({ workId, watchIndex, seasonNumber, episodeNumber, ...values })
        .onConflictDoUpdate({
          target: [
            viewEpisode.workId,
            viewEpisode.watchIndex,
            viewEpisode.seasonNumber,
            viewEpisode.episodeNumber,
          ],
          set: { ...values, updatedAt: new Date() },
        })
        .run();
      stats.viewEpisodes += 1;
    }

    /* 关联表：复合主键即幂等手段 */
    for (const row of d.viewRecordTags) {
      const viewRecordId = viewRecordIdBySourceKey.get(row.sourceKey);
      const tagId = tagIdByName.get(row.tagName);
      if (viewRecordId == null || tagId == null) continue;
      tx.insert(viewRecordTag).values({ viewRecordId, tagId }).onConflictDoNothing().run();
      stats.viewRecordTags += 1;
    }

    /*
     * v1 备份兼容：那时候标签挂在作品上，现在要折算到该作品「最新一条流水」，
     * 口径与迁移 0006 的存量回填保持一致（观看日期倒序，日期相同取 id 大的；
     * 没有观看日期的排最后）。
     */
    if (d.workTags?.length) {
      const latestRecordByWorkId = new Map<number, { id: number; watchedAt: string | null }>();
      const isNewer = (
        candidate: { id: number; watchedAt: string | null },
        current: { id: number; watchedAt: string | null },
      ) => {
        const a = candidate.watchedAt ?? "";
        const b = current.watchedAt ?? "";
        return a > b || (a === b && candidate.id > current.id);
      };

      for (const row of d.viewRecords) {
        if (!row?.sourceKey || !row.workKey) continue;
        const viewRecordId = viewRecordIdBySourceKey.get(row.sourceKey);
        const workId = workIdByKey.get(row.workKey);
        if (viewRecordId == null || workId == null) continue;
        const candidate = { id: viewRecordId, watchedAt: row.watchedAt ?? null };
        const current = latestRecordByWorkId.get(workId);
        if (!current || isNewer(candidate, current)) latestRecordByWorkId.set(workId, candidate);
      }

      for (const row of d.workTags) {
        const workId = workIdByKey.get(row.workKey);
        const tagId = tagIdByName.get(row.tagName);
        if (workId == null || tagId == null) continue;
        // 该作品一条流水都没有（例如仅「想看」）时无处可挂，跳过
        const latestRecordId = latestRecordByWorkId.get(workId)?.id;
        if (latestRecordId == null) continue;
        tx.insert(viewRecordTag)
          .values({ viewRecordId: latestRecordId, tagId })
          .onConflictDoNothing()
          .run();
        stats.viewRecordTags += 1;
      }
    }

    for (const row of d.collectionItems) {
      const collectionId = collectionIdByName.get(row.collectionName);
      const workId = workIdByKey.get(row.workKey);
      if (!collectionId || !workId) continue;
      tx.insert(collectionItem)
        .values({ collectionId, workId, sortOrder: row.sortOrder ?? 0, note: row.note ?? null })
        .onConflictDoUpdate({
          target: [collectionItem.collectionId, collectionItem.workId],
          set: { sortOrder: row.sortOrder ?? 0, note: row.note ?? null },
        })
        .run();
      stats.collectionItems += 1;
    }

    return stats;
  });
}

/* -------------------------------------------------------------------------- */
/*                              元数据补全统计                                 */
/* -------------------------------------------------------------------------- */

/**
 * 待补 TMDB 元数据的作品：有 tmdbId，但要么从没同步过详情，
 * 要么主演还是空的。
 *
 * 后一条是为存量数据准备的——它们当年同步过，那时还不抓主演，
 * 只按 metadata_synced_at 判会永远漏掉。
 * 判据只看主演：它是后加的字段，旧同步代码从没写过，必然为空；
 * 而国家当年是从豆瓣列表页的 item.country 写进去的，存量数据里非空，
 * 拿它当判据会一条都判不出来。
 * 简介同理：老同步把 TMDB 检索结果的 overview 原样写入，而那个接口
 * 通常返回空串，存量作品的简介其实一直没落库，这里要一并纳入待补。
 */
export const pendingMetadataWhere = and(
  isNotNull(work.tmdbId),
  or(
    isNull(work.metadataSyncedAt),
    eq(work.cast, "[]"),
    isNull(work.overview),
    eq(work.overview, ""),
  ),
);

/** 待补 TMDB 元数据的作品数。 */
export function countPendingMetadata(): number {
  return db
    .select({ n: count() })
    .from(work)
    .where(pendingMetadataWhere)
    .get()?.n ?? 0;
}

/** 逐条取出待补元数据的作品，供手动回填使用。 */
export function listPendingMetadata(limit = 200): { id: number; mediaType: string; tmdbId: number; title: string }[] {
  return db
    .select({ id: work.id, mediaType: work.mediaType, tmdbId: work.tmdbId, title: work.title })
    .from(work)
    .where(pendingMetadataWhere)
    .limit(limit)
    .all()
    .map((row) => ({ id: row.id, mediaType: row.mediaType, tmdbId: row.tmdbId as number, title: row.title }));
}
