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

/**
 * 缓存连接：开发环境热重载会重复求值本模块，用 globalThis 兜住，避免句柄泄漏。
 */
const globalForDb = globalThis as unknown as {
  __cinetraceSqlite?: Database.Database;
};

/**
 * 建立连接。刻意只在第一次真正用到数据库时调用，不在模块顶层调用：
 * `next build` 的 page data collection 阶段会用多个 worker 并发 import 本模块，
 * 若 import 即开库并切 WAL，多个进程会同时争抢 journal_mode 切换所需的独占锁，
 * 直接导致 SQLITE_BUSY（database is locked）构建失败。
 */
function getSqlite(): Database.Database {
  const existing = globalForDb.__cinetraceSqlite;
  if (existing) return existing;

  // 首次连接时确保目录先存在（better-sqlite3 不会自动建目录）
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);

  // 多容器同时写入时，等锁而不是直接报 SQLITE_BUSY
  sqlite.pragma("busy_timeout = 5000");
  // NORMAL 在 WAL 下已足够安全，且写入快得多
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  // WAL 让 web 与 worker 两个容器可以并发读写同一份库。
  // 切换 journal_mode 需要瞬时独占锁，且 SQLite 在这里不保证走 busy handler，
  // 所以自己重试：多个进程/容器同时冷启动时不至于直接 SQLITE_BUSY。
  switchToWal(sqlite);

  globalForDb.__cinetraceSqlite = sqlite;
  return sqlite;
}

/** 把日志模式切到 WAL；被其他连接占锁时重试若干次。已是 WAL 则直接返回。 */
function switchToWal(sqlite: Database.Database): void {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      sqlite.pragma("journal_mode = WAL");
      return;
    } catch (error) {
      const busy =
        error instanceof Error &&
        (error as { code?: string }).code === "SQLITE_BUSY";
      if (!busy || Date.now() >= deadline) throw error;
      // 同步驱动只能同步等待，20ms 退避避免空转抢锁
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

/**
 * 惰性代理：对外接口与 Database 完全一致，但直到第一次真正使用时才建连。
 * drizzle 构造时只持有引用、不执行任何 SQL，因此 db 可以在模块顶层安全创建。
 */
const sqlite = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = getSqlite();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const db = drizzle({ client: sqlite, schema });
export { sqlite, schema };
export type DB = typeof db;
