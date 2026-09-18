import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { rawArchive } from "@/db/schema";

/**
 * 原始响应归档。
 *
 * 报文以 gzip 落盘（NAS 本地卷），数据库只留元信息索引。
 * 目的是「豆瓣改版后零请求重解析」：把 parserVersion 递增，
 * 历史报文会被当作新记录重新解析一遍，不需要再打一次豆瓣。
 * 唯一索引 (urlHash, parserVersion) 同时保证了重复抓取不会产生冗余文件。
 */

export type ArchiveKind = "list" | "detail" | "rss" | "tmdb";

const EXTENSION: Record<ArchiveKind, string> = {
  list: "html",
  detail: "html",
  rss: "html",
  tmdb: "json",
};

/** 归档根目录。NAS 上部署时由 docker-compose 指向 /data/archive。 */
function archiveRoot(): string {
  const raw = process.env.ARCHIVE_DIR?.trim() || "data/archive";
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), raw);
}

function hashOf(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export type ArchiveInput = {
  url: string;
  kind: ArchiveKind;
  /** 原始响应体（HTML 原文或 JSON 原文） */
  body: string;
  parserVersion: string;
  fetchedAt?: Date;
};

/**
 * 落盘并登记一条归档。
 * 同一 (urlHash, parserVersion) 已存在时直接跳过——抓取重跑不该反复写盘。
 * 返回落盘相对路径；跳过时返回 null。
 */
export function archiveRaw(input: ArchiveInput): string | null {
  const urlHash = hashOf(input.url);

  const existing = db
    .select({ path: rawArchive.path })
    .from(rawArchive)
    .where(and(eq(rawArchive.urlHash, urlHash), eq(rawArchive.parserVersion, input.parserVersion)))
    .get();
  if (existing) return null;

  // 按 kind/日期 分目录，避免单目录堆积上万个文件
  const day = (input.fetchedAt ?? new Date()).toISOString().slice(0, 10);
  const relative = path.join(input.kind, day, `${urlHash}.${EXTENSION[input.kind]}.gz`);
  const absolute = path.join(archiveRoot(), relative);

  try {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const gzipped = gzipSync(Buffer.from(input.body, "utf8"));
    fs.writeFileSync(absolute, gzipped);

    db.insert(rawArchive)
      .values({
        urlHash,
        url: input.url,
        kind: input.kind,
        path: relative,
        parserVersion: input.parserVersion,
        sizeBytes: gzipped.byteLength,
        fetchedAt: input.fetchedAt ?? new Date(),
      })
      .onConflictDoNothing()
      .run();

    return relative;
  } catch (error) {
    // 归档只是兜底能力，磁盘满等异常不应中断同步主流程
    console.error(`[archive] 写盘失败 ${relative}`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** 读回一条归档报文。用于重解析历史数据，不发起任何网络请求。 */
export function readArchive(relativePath: string): string | null {
  try {
    const absolute = path.join(archiveRoot(), relativePath);
    return gunzipSync(fs.readFileSync(absolute)).toString("utf8");
  } catch {
    return null;
  }
}
