import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  collection,
  collectionItem,
  platform,
  setting,
  tag,
  user,
  viewRecord,
  work,
  workTag,
  type NewWork,
} from "@/db/schema";
import { APP_VERSION } from "@/lib/version";

/**
 * 备份与恢复。
 *
 * 只备份「用户自己的数据」——观影记录、作品的身份标识（豆瓣/TMDB id）、
 * 平台、标签、片单、设置与账号。作品的描述性元数据（海报、简介、时长、
 * 分季结构等）刻意不备份：它们随时可以从 TMDB 重新拉取，且会过期，
 * 放进备份只会让文件臃肿。导入后按需用「补全元数据」按钮回填。
 */

export const BACKUP_FORMAT = "cinetrace-backup";
export const BACKUP_VERSION = 1;

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
    tags: { name: string; color: string | null }[];
    works: BackupWork[];
    viewRecords: BackupViewRecord[];
    workTags: { workKey: string; tagName: string }[];
    collections: { name: string; description: string | null; coverPath: string | null; sortOrder: number }[];
    collectionItems: { collectionName: string; workKey: string; sortOrder: number; note: string | null }[];
  };
};

export type ImportStats = {
  users: number;
  settings: number;
  platforms: number;
  tags: number;
  works: number;
  viewRecords: number;
  workTags: number;
  collections: number;
  collectionItems: number;
};

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
    }));

  const workTags = db
    .select({ workId: workTag.workId, tagId: workTag.tagId })
    .from(workTag)
    .all()
    .map((row) => ({ workKey: workIdToKey.get(row.workId) ?? "", tagName: tagIdToName.get(row.tagId) ?? "" }))
    .filter((row) => row.workKey && row.tagName);

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
      works,
      viewRecords,
      workTags,
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
      tags: data.tags ?? [],
      works: data.works,
      viewRecords: data.viewRecords,
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
    tags: 0,
    works: 0,
    viewRecords: 0,
    workTags: 0,
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

    /* 设置：整行按 key 覆盖。 */
    for (const row of d.settings) {
      if (!row?.key) continue;
      tx.insert(setting)
        .values({ key: row.key, value: row.value })
        .onConflictDoUpdate({ target: setting.key, set: { value: row.value, updatedAt: new Date() } })
        .run();
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
        matchStatus: row.matchStatus ?? "pending",
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
      };
      tx.insert(viewRecord)
        .values({ ...values, sourceKey: row.sourceKey })
        .onConflictDoUpdate({ target: viewRecord.sourceKey, set: { ...values, updatedAt: new Date() } })
        .run();
      stats.viewRecords += 1;
    }

    /* 关联表：复合主键即幂等手段 */
    for (const row of d.workTags) {
      const workId = workIdByKey.get(row.workKey);
      const tagId = tagIdByName.get(row.tagName);
      if (!workId || !tagId) continue;
      tx.insert(workTag).values({ workId, tagId }).onConflictDoNothing().run();
      stats.workTags += 1;
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

/** 待补 TMDB 元数据的作品数：有 tmdbId 但从没同步过详情。 */
export function countPendingMetadata(): number {
  return db
    .select({ n: count() })
    .from(work)
    .where(and(isNotNull(work.tmdbId), isNull(work.metadataSyncedAt)))
    .get()?.n ?? 0;
}

/** 逐条取出待补元数据的作品，供手动回填使用。 */
export function listPendingMetadata(limit = 200): { id: number; mediaType: string; tmdbId: number; title: string }[] {
  return db
    .select({ id: work.id, mediaType: work.mediaType, tmdbId: work.tmdbId, title: work.title })
    .from(work)
    .where(and(isNotNull(work.tmdbId), isNull(work.metadataSyncedAt)))
    .limit(limit)
    .all()
    .map((row) => ({ id: row.id, mediaType: row.mediaType, tmdbId: row.tmdbId as number, title: row.title }));
}
