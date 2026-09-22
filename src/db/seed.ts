import { randomInt } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./index";
import { iconLibrary, platform, setting, sourceChannel, user } from "./schema";
import {
  DEFAULT_ICON_LIBRARIES,
  DEFAULT_PLATFORMS,
  DEFAULT_SETTINGS,
  DEFAULT_SOURCE_CHANNELS,
} from "./defaults";
import { hashPassword } from "@/lib/password";

/**
 * 初始化基础数据。可重复运行：
 * - 平台/设置按名字或 key 幂等插入
 * - 管理员账号优先取环境变量 ADMIN_USERNAME / ADMIN_PASSWORD；
 *   未配置时，首次部署（库中还没有任何账号）自动生成一组初始账号，
 *   并把明文密码打印到日志，方便在容器日志里直接取用。
 * 用法：npm run db:seed
 */

/** 首次部署的默认账号名。密码随机生成，避免公开仓库里的固定弱密码 */
const DEFAULT_ADMIN_USERNAME = "admin";

/**
 * 已废弃的设置键。设置读取只做「默认值 + 库中行」的合并，从不删除多余键，
 * 改过名的键会一直滞留在库里；这里在每次启动时顺手清掉。
 * 只列明确作废的键，不动用户可能自行添加的其他设置。
 */
const OBSOLETE_SETTING_KEYS = [
  /** 原名，单位毫秒；已改为 sync.minDelaySec / sync.maxDelaySec（秒） */
  "sync.minDelayMs",
  "sync.maxDelayMs",
];

/** 去掉了 0/O、1/l/I 等易混淆字符，方便照着日志手抄 */
const PASSWORD_ALPHABET =
  "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 14): string {
  let password = "";
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

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

  /*
   * 来源渠道预置一级与「流媒体」下的三家二级。
   * （parent_id, name）唯一索引在 SQLite 里拦不住一级重名（NULL 互不相等），
   * 所以一级要按 name + parent_id IS NULL 显式查重；二级有父级参与，
   * 唯一索引本身就能拦，但同样走显式查重以统一逻辑。
   */
  let channelCount = 0;
  for (const c of DEFAULT_SOURCE_CHANNELS) {
    let parent = db
      .select()
      .from(sourceChannel)
      .where(and(isNull(sourceChannel.parentId), eq(sourceChannel.name, c.name)))
      .get();
    if (!parent) {
      parent = db
        .insert(sourceChannel)
        .values({ name: c.name, color: c.color, sortOrder: c.sortOrder })
        .returning()
        .get();
    }
    channelCount += 1;

    for (const child of c.children) {
      const exists = db
        .select()
        .from(sourceChannel)
        .where(and(eq(sourceChannel.parentId, parent.id), eq(sourceChannel.name, child.name)))
        .get();
      if (!exists) {
        db.insert(sourceChannel)
          .values({
            name: child.name,
            parentId: parent.id,
            iconData: child.iconData,
            color: child.color,
            sortOrder: child.sortOrder,
          })
          .run();
        channelCount += 1;
      }
    }
  }
  console.log(`来源渠道：${channelCount} 个分类已就绪`);

  for (const [index, lib] of DEFAULT_ICON_LIBRARIES.entries()) {
    const exists = db.select().from(iconLibrary).where(eq(iconLibrary.url, lib.url)).get();
    if (!exists) {
      db.insert(iconLibrary).values({ name: lib.name, url: lib.url, sortOrder: index }).run();
    }
  }
  console.log(`图标库：${DEFAULT_ICON_LIBRARIES.length} 项已就绪`);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = db.select().from(setting).where(eq(setting.key, key)).get();
    if (!exists) db.insert(setting).values({ key, value: JSON.stringify(value) }).run();
  }
  console.log(`设置：${Object.keys(DEFAULT_SETTINGS).length} 项已就绪`);

  const removed = db
    .delete(setting)
    .where(inArray(setting.key, OBSOLETE_SETTING_KEYS))
    .run();
  if (removed.changes > 0) {
    console.log(`设置：已清理 ${removed.changes} 项废弃键`);
  }

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

  await createUser(DEFAULT_ADMIN_USERNAME, generatePassword());
}

await seed();
