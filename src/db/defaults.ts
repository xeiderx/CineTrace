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

/**
 * 预置来源渠道的图标。
 *
 * 手绘的品牌标 SVG 直接内联成 data URL，不落盘也不外链：
 * `public/` 在 Docker 镜像里是只读层，容器重建就没了；外链又会把
 * 「NAS 上离线可用」这件事弄坏。图形只取品牌色 + 简化字形，够在小尺寸下认出来即可。
 */
const CHANNEL_ICON_IQIYI =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzAwREM1QSIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xMSA5aDMuNHYxNEgxMXoiLz48Y2lyY2xlIGN4PSIxMi43IiBjeT0iNS42IiByPSIyLjIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";
const CHANNEL_ICON_YOUKU =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iI0ZGNkEwMCIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xMi41IDkuNWwxMC41IDYuNS0xMC41IDYuNXoiLz48L3N2Zz4=";
const CHANNEL_ICON_TENCENT =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzE1OEJGNSIvPjxwYXRoIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyLjYiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0xMy4yIDEwLjRsOC42IDUuNi04LjYgNS42eiIvPjwvc3ZnPg==";

/** 二级来源渠道（必须挂在一级下，因此不再有 children） */
export type DefaultSourceChannelChild = {
  name: string;
  color: string;
  sortOrder: number;
  iconData: string;
};

/** 一级来源渠道 */
export type DefaultSourceChannel = {
  name: string;
  color: string;
  sortOrder: number;
  children: DefaultSourceChannelChild[];
};

/**
 * 预置来源渠道。
 *
 * 一级只给最通用的三类；流媒体下的三家是大多数人都有的，顺手预置掉，
 * 其余（PT 站点、EMBY 服下的具体站点）因人而异，留给用户自己加。
 */
export const DEFAULT_SOURCE_CHANNELS: DefaultSourceChannel[] = [
  {
    name: "流媒体",
    color: "#5b9bd5",
    sortOrder: 0,
    children: [
      { name: "爱奇艺", color: "#00dc5a", sortOrder: 0, iconData: CHANNEL_ICON_IQIYI },
      { name: "优酷", color: "#ff6a00", sortOrder: 1, iconData: CHANNEL_ICON_YOUKU },
      { name: "腾讯视频", color: "#158bf5", sortOrder: 2, iconData: CHANNEL_ICON_TENCENT },
    ],
  },
  { name: "PT站点", color: "#e0a458", sortOrder: 1, children: [] },
  { name: "EMBY服", color: "#9b7bd5", sortOrder: 2, children: [] },
];

/**
 * 预置图标库。
 *
 * 都是别人维护的 Emby / Fileball 图标 JSON，结构与字段一致
 * （`{ name, description, icons: [{ name, url }] }`），用户可以自行增删。
 * 图片全在 raw.githubusercontent.com 上，浏览器直连不一定通，
 * 取 JSON 与取图都走服务端代理。
 */
export const DEFAULT_ICON_LIBRARIES = [
  {
    name: "离歌Emby专用",
    url: "https://raw.githubusercontent.com/lige47/QuanX-icon-rule/refs/heads/main/lige-emby-icon.json",
  },
  {
    name: "恩秀Emby图标库",
    url: "https://raw.githubusercontent.com/sooyaaabo/IconLibrary/main/Emby-Icon.json",
  },
  {
    name: "Emby图标库(圆)@baiitang",
    url: "https://raw.githubusercontent.com/baiitang/Sakura/main/Fileball/Yuan/tubiao.json",
  },
  {
    name: "Emby图标库(方)@baiitang",
    url: "https://raw.githubusercontent.com/baiitang/Sakura/main/Fileball/Fang/tubiao.json",
  },
  {
    name: "五芙临门 · Emby透明图标库",
    url: "https://raw.githubusercontent.com/xiyuliu509/Player-Icon/refs/heads/master/invisible.json",
  },
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
   * 上一次「手动增量」的完成时间（ISO 字符串）。两次手动增量之间至少间隔 30 分钟，
   * 避免连点。自动同步的 2 小时间隔另有锚点（sync_run 里最近一次结束时间），
   * 手动跑完会顺带刷新它。
   */
  "douban.lastManualIncAt": "",
  /**
   * 连续被豆瓣挡下的轮次数。0 表示正常，>=1 表示正在退避。
   *
   * 缩到 2 小时间隔后请求密度翻倍，遇到 403 或跳到 sec.douban.com 时就得往回收：
   * 连续成功一轮立即清零回到 2 小时，让偶发拦截不会长期压低同步频率。
   * 必须落库——web 与 worker 是两个进程，内存标记互相看不见。
   */
  "douban.blockedStreak": 0,
  /** 最近一次被挡下的时间（ISO 字符串），空串表示没有。概览页在退避提示里带上它 */
  "douban.blockedAt": "",
  /**
   * 豆瓣「看过」列表页自己声明的总条数。0 表示还没抓到过。
   *
   * 这个数字通常比本地记录数大：豆瓣把它删除或合并掉的条目仍计入总数，
   * 但列表接口不再返回它们（实测 2198 声明 / 2178 实返，两种接口口径一致）。
   * 存下来只为在概览页显示差额，让「本地少几条」这件事有个明确解释，
   * 而不是看起来像同步没跑完。
   */
  "douban.lastWatchedTotal": 0,
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
