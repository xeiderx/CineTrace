import { eq } from "drizzle-orm";
import { db } from "./index";
import { platform, setting, user } from "./schema";
import { DEFAULT_PLATFORMS, DEFAULT_SETTINGS } from "./defaults";
import { hashPassword } from "@/lib/password";

/**
 * 初始化基础数据。可重复运行：
 * - 平台/设置按名字或 key 幂等插入
 * - 管理员账号来自环境变量 ADMIN_USERNAME / ADMIN_PASSWORD，
 *   仅在库中尚无该用户时创建
 * 用法：npm run db:seed
 */
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

  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.log("未提供 ADMIN_USERNAME / ADMIN_PASSWORD，跳过管理员账号创建");
    console.log("可稍后在首次访问时通过引导页设置");
    return;
  }

  const exists = db.select().from(user).where(eq(user.username, username)).get();
  if (exists) {
    console.log(`管理员账号 ${username} 已存在，跳过`);
    return;
  }

  db.insert(user)
    .values({
      username,
      passwordHash: await hashPassword(password),
      displayName: username,
    })
    .run();
  console.log(`管理员账号 ${username} 已创建`);
}

await seed();
