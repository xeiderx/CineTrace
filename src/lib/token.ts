import { createHash, randomBytes } from "node:crypto";

/** 生成 32 字节随机 token，用于会话 Cookie */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 会话 token 只以 sha256 落库，库被读取也无法直接冒用登录态 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
