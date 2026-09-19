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
  /**
   * 窗口开启后的随机延迟区间（分钟）。跨夜积压的第一次抓取若总在开窗那一刻准点发生，
   * 时间一长就是很明显的机械特征，这里让它落在 [下限, 上限] 内随机。
   */
  "sync.windowJitterMin": 15,
  "sync.windowJitterMax": 30,
  /** 两次请求之间的随机延迟区间（秒），防风控 */
  "sync.minDelaySec": 3,
  "sync.maxDelaySec": 8,
  "tmdb.language": "zh-CN",
  /** TMDB API Key（v3）。设置页填写，优先于环境变量 TMDB_API_KEY */
  "tmdb.apiKey": "",
  "ui.defaultRatingScale": 5,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
