import { hash, verify } from "@node-rs/argon2";

/**
 * 密码哈希。@node-rs/argon2 默认即 argon2id，
 * 参数为 memoryCost 19MiB / timeCost 2 / parallelism 1，
 * 兼顾安全与 NAS 设备上的响应速度，故此处不再覆写。
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // 哈希格式损坏时视为验证失败，不抛异常打断登录流程
    return false;
  }
}
