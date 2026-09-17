import { eq } from "drizzle-orm";
import { db } from "./index";
import { platform, setting, user } from "./schema";
import { DEFAULT_PLATFORMS, DEFAULT_SETTINGS } from "./defaults";
import { hashPassword } from "@/lib/password";

/**
 * 初始化基础数据。可重复运行：
 * - 平台/设置按名字或 key 幂等插入
 * - 管理员账号优先取环境变量 ADMIN_USERNAME / ADMIN_PASSWORD；
 *   未配置时，首次部署（库中还没有任何账号）用下面的默认账号密码创建，
 *   并把明文打印到日志，方便在容器日志里直接取用。
 * 用法：npm run db:seed
 */

/** 首次部署的默认账号。仅用于让你能进得去，登录后请立刻修改密码 */
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "cinetrace123";

/** 仅在账号被创建时输出，便于 docker compose logs 一眼看到 */
function printCredentials(username: string, password: string) {
  console.log("");
  console.log("========================================================");
  console.log("  CineTrace 初始账号已创建（仅首次部署时输出）");
  console.log(`  账号：${username}`);
  console.log(`  密码：${password}`);
  console.log("  请登录后立即修改密码，此信息不会再次出现");
  console.log("========================================================");
  console.log("");
}

async function createUser(username: string, password: string) {
  db.insert(user)
    .values({
      username,
      passwordHash: await hashPassword(password),
      displayName: username,
    })
    .run();
  printCredentials(username, password);
}

async function seed() {
  for (const p of DEFAULT_PLATFORMS) {
    const exists = db.select().from(platform).where(eq(platform.name, p.name)).get();
    if (!exists) db.insert(platform).values(p).run();
  }
  console.log(`平台：${DEFAULT_PLATFORMS.length} 项已就绪`);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = db.select().from(setting).where(eq(setting.key, key)).get();
    if (!exists) db.insert(setting).values({ key, value: JSON.stringify(value) }).run();
  }
  console.log(`设置：${Object.keys(DEFAULT_SETTINGS).length} 项已就绪`);

  const envUsername = process.env.ADMIN_USERNAME?.trim();
  const envPassword = process.env.ADMIN_PASSWORD?.trim();

  if (envUsername && envPassword) {
    const exists = db.select().from(user).where(eq(user.username, envUsername)).get();
    if (exists) {
      console.log(`管理员账号 ${envUsername} 已存在，跳过`);
      return;
    }
    await createUser(envUsername, envPassword);
    return;
  }

  if (envUsername || envPassword) {
    console.log("ADMIN_USERNAME 与 ADMIN_PASSWORD 需同时提供，当前只配置了其中一个，跳过");
    return;
  }

  const existing = db.select().from(user).get();
  if (existing) {
    console.log(`已有账号 ${existing.username}，跳过初始账号创建`);
    return;
  }

  await createUser(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD);
}

await seed();
