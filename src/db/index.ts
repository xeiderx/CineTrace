import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * 解析数据库文件路径。
 * 默认 ./data/cinetrace.db，容器里由 Docker volume 映射到 NAS 本地目录。
 */
function resolveDbPath(): string {
  const raw = process.env.DATABASE_PATH?.trim();
  if (!raw) return path.resolve(process.cwd(), "data", "cinetrace.db");
  // 路径来自部署环境变量，属于运行时配置而非构建期依赖，无需被 Turbopack 追踪
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), raw);
}

export const dbPath = resolveDbPath();

function createConnection() {
  // Next.js 开发模式下会热重载模块，这里必须确保目录先存在
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);

  // WAL 让 web 与 worker 两个容器可以并发读写同一份库
  sqlite.pragma("journal_mode = WAL");
  // NORMAL 在 WAL 下已足够安全，且写入快得多
  sqlite.pragma("synchronous = NORMAL");
  // 多容器同时写入时，等锁而不是直接报 SQLITE_BUSY
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  return sqlite;
}

/**
 * 开发环境把连接缓存到 globalThis，避免热重载时不断开新连接耗尽句柄。
 */
const globalForDb = globalThis as unknown as {
  __cinetraceSqlite?: Database.Database;
};

const sqlite = globalForDb.__cinetraceSqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__cinetraceSqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { sqlite, schema };
export type DB = typeof db;
