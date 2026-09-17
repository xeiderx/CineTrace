/**
 * 预置数据。seed 脚本与运行时读取设置都以此为唯一来源，
 * 避免「库里没有该 key 时用哪份默认值」出现两套答案。
 */

/** 预置观影平台。默认平台全局只能有一个，观影记录未指定平台时落到它。 */
export const DEFAULT_PLATFORMS = [
  { name: "家庭影院", icon: "monitor-play", color: "#e0a458", isDefault: true },
  { name: "电脑", icon: "laptop", color: "#5b9bd5", isDefault: false },
  { name: "手机/平板", icon: "smartphone", color: "#9b7bd5", isDefault: false },
  { name: "影院", icon: "clapperboard", color: "#e06c75", isDefault: false },
] as const;

/** 预置应用设置。key 用点分命名空间，值与前端表单一一对应。 */
export const DEFAULT_SETTINGS = {
  "douban.uid": "",
  "sync.enabled": false,
  /** 允许抓取的作息窗口（本地时区），避开深夜以免异常流量 */
  "sync.windowStart": "09:00",
  "sync.windowEnd": "23:00",
  /** 两次请求之间的随机延迟区间，防风控 */
  "sync.minDelayMs": 3000,
  "sync.maxDelayMs": 8000,
  "tmdb.language": "zh-CN",
  "ui.defaultRatingScale": 5,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
