import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, dbPath } from "./index";

/**
 * 执行迁移。可重复运行，已应用过的迁移会自动跳过。
 * 用法：npm run db:migrate
 */
migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });

console.log(`迁移完成：${dbPath}`);
