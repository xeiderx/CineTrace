/**
 * 认证相关常量。
 * 单独成文件是为了让 Edge 运行时的 middleware 能安全引用——
 * middleware 不能引入任何依赖 better-sqlite3 的模块。
 */
export const SESSION_COOKIE = "cinetrace_session";

/** 会话有效期 30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
