import { authenticate, createSession, destroySession, getSessionUser } from "@/lib/auth";

const bad = await authenticate("admin", "wrong-password");
console.log("错误密码 ->", bad === null ? "拒绝（OK）" : "竟然通过了（FAIL）");

const user = await authenticate("admin", "cinetrace123");
console.log("正确密码 ->", user ? `通过，id=${user.id} 用户名=${user.username}` : "失败（FAIL）");

if (user) {
  const { token, expiresAt } = createSession(user.id);
  console.log("签发会话 ->", token.slice(0, 8) + "…", "过期于", expiresAt.toISOString());

  const restored = getSessionUser(token);
  console.log("会话校验 ->", restored?.username === "admin" ? "OK" : "FAIL");
  console.log("伪造 token ->", getSessionUser("not-a-real-token") === null ? "拒绝（OK）" : "FAIL");

  destroySession(token);
  console.log("登出后校验 ->", getSessionUser(token) === null ? "已失效（OK）" : "仍有效（FAIL）");
}
