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
  /**
   * 是否抓取「在看」「想看」两个小列表。
   * 「看过」是主列表必须抓；这两个列表通常只有几十条，抓一轮的代价只有首页一次请求，
   * 但也有人只想同步已看记录，所以留开关。
   */
  "douban.syncWish": true,
  "douban.syncWatching": true,
  /**
   * 上一次「全量回扫」的完成时间（ISO 字符串）。常规轮只抓每个列表的首页、
   * 遇到已知条目即停，靠这个时间戳每周放行一次完整翻页——
   * 用来捡回用户事后修改的老条目（评分、短评）与被删改的条目。
   * 手动全量成功后同样刷新它，因此「手动全量需间隔 72 小时」也是对着它算的：
   * 起点是任意一次全量（含自动），防止刚自动跑完又立刻手动再来一轮。
   */
  "douban.lastFullSyncAt": "",
  /**
   * 全量回扫的断点游标，格式 `<status>:<start>`（如 `watched:450`），空串表示没有断点。
   *
   * 首次全量要回扫两千多条、逐条等 TMDB，耗时数小时。调度器只在任务启动前查一次
   * 作息窗口，跑起来后就不再管，于是傍晚启动的一轮会一路抓到凌晨——连续数小时的
   * 不间断请求是很明显的机器特征。改成撞上窗口结束就记下游标、本轮中止，
   * 下一轮（仍是全量）从断点页接着跑，绝不跨夜。
   */
  "douban.syncCursor": "",
  /**
   * 上一次「手动增量」的完成时间（ISO 字符串）。两次手动增量之间至少间隔 1 小时，
   * 避免连点。自动同步的 6 小时间隔另有锚点（sync_run 里最近一次结束时间），
   * 手动跑完会顺带刷新它。
   */
  "douban.lastManualIncAt": "",
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
