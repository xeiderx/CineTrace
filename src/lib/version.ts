/**
 * 应用版本号的唯一来源：package.json 的 "version" 字段。
 * 由 next.config.ts 在构建时把该值注入 NEXT_PUBLIC_APP_VERSION，
 * 所以发版时只需要改 package.json 里那一个数字。
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/** 展示用文案，带 v 前缀 */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
