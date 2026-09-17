import { eq } from "drizzle-orm";
import { db } from "@/db";
import { setting } from "@/db/schema";
import { DEFAULT_SETTINGS, type SettingKey } from "@/db/defaults";

/** 读取单个设置；库中缺失时回落到默认值，保证调用方永远拿到可用值。 */
export function getSetting<K extends SettingKey>(
  key: K,
): (typeof DEFAULT_SETTINGS)[K] {
  const row = db.select().from(setting).where(eq(setting.key, key)).get();
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value) as (typeof DEFAULT_SETTINGS)[K];
  } catch {
    // 手工改库导致 JSON 损坏时不要让整个流程崩掉
    return DEFAULT_SETTINGS[key];
  }
}

/** 写入设置。值统一 JSON 编码，便于存对象与数组。 */
export function setSetting(key: string, value: unknown): void {
  const encoded = JSON.stringify(value);
  db.insert(setting)
    .values({ key, value: encoded })
    .onConflictDoUpdate({
      target: setting.key,
      set: { value: encoded, updatedAt: new Date() },
    })
    .run();
}

/** 一次取全部设置，供设置页表单使用。 */
export function getSettings(): Record<string, unknown> {
  const rows = db.select().from(setting).all();
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      // 忽略损坏项，保留默认值
    }
  }
  return result;
}
