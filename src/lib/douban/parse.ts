import { load } from "cheerio";

/**
 * 豆瓣 HTML 解析层。
 * 只做「HTML → 结构化对象」的纯函数转换，不发起任何请求，
 * 因此可以对着归档下来的历史报文零请求重跑。
 *
 * 选择器来自 Phase 0 实测（reference/phase0-pow.mjs、phase0-strategy.mjs）。
 */

/** 解析器版本。豆瓣改版后递增此值即可让归档重解析产生新记录。 */
export const PARSER_VERSION = "p3.0";

/* -------------------------------------------------------------------------- */
/*                                   列表页                                    */
/* -------------------------------------------------------------------------- */

export type ListPageItem = {
  doubanId: string | null;
  /** 中文名（title 的第一段） */
  titleCn: string;
  /** 原名与别名（title 的后续段） */
  aliases: string[];
  /** 1-5 星 */
  rating: number | null;
  year: number | null;
  /** 标记日期，YYYY-MM-DD；缺失为 null */
  markedAt: string | null;
  /** 短评 */
  comment: string | null;
  /** 详情行按 " / " 切开的原始片段 */
  introParts: string[];
  country: string | null;
};

/**
 * 已知制片国家/地区。豆瓣的详情行里国家与导演/主演混在一起，
 * 只能靠白名单反查——比按位置取更抗改版。
 */
const COUNTRIES = new Set([
  "中国大陆", "美国", "香港", "台湾", "日本", "韩国", "法国", "英国", "德国",
  "意大利", "西班牙", "泰国", "印度", "加拿大", "澳大利亚", "俄罗斯", "瑞典",
  "丹麦", "挪威", "巴西", "墨西哥", "阿根廷", "波兰", "比利时", "荷兰", "奥地利",
  "瑞士", "爱尔兰", "新西兰", "伊朗", "土耳其", "以色列", "南非", "捷克",
  "匈牙利", "希腊", "葡萄牙", "芬兰", "冰岛", "乌克兰", "越南", "新加坡",
  "马来西亚", "菲律宾", "印度尼西亚", "智利", "哥伦比亚", "秘鲁", "罗马尼亚",
  "保加利亚", "塞尔维亚", "克罗地亚", "斯洛文尼亚", "斯洛伐克", "爱沙尼亚",
  "拉脱维亚", "立陶宛", "格鲁吉亚", "亚美尼亚", "哈萨克斯坦", "蒙古", "尼泊尔",
  "斯里兰卡", "巴基斯坦", "孟加拉国", "缅甸", "柬埔寨", "老挝", "文莱", "卡塔尔",
  "阿联酋", "沙特阿拉伯", "黎巴嫩", "约旦", "摩洛哥", "突尼斯", "阿尔及利亚",
  "肯尼亚", "尼日利亚", "加纳", "埃塞俄比亚", "坦桑尼亚", "乌干达", "津巴布韦",
  "古巴", "委内瑞拉", "厄瓜多尔", "玻利维亚", "巴拉圭", "乌拉圭", "哥斯达黎加",
  "巴拿马", "危地马拉", "多米尼加", "波多黎各", "牙买加", "海地",
  "特立尼达和多巴哥", "巴哈马", "巴巴多斯",
]);

const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;

/**
 * 解析豆瓣个人页的影视列表页。
 * 「看过 /collect」「在看 /do」「想看 /wish」三处 HTML 结构一致，共用此解析。
 * 每页固定 15 条（豆瓣的约定），翻页靠 start 参数。
 */
export function parseListPage(html: string): ListPageItem[] {
  const $ = load(html);
  const items: ListPageItem[] = [];

  $("div.item").each((_, el) => {
    const $el = $(el);
    const titleA = $el.find(".title a").first();
    const href = titleA.attr("href") || "";
    const rawTitle = titleA.text().replace(/\s+/g, " ").trim();
    if (!rawTitle) return;

    const parts = rawTitle.split(" / ").map((s) => s.trim());
    const ratingCls = ($el.find('span[class^="rating"]').first().attr("class") || "").match(
      /rating(\d)-t/,
    );
    const intro = $el.find("li.intro").text().replace(/\s+/g, " ").trim();
    const introParts = intro.split(" / ").map((s) => s.trim());
    const yearMatch = intro.match(YEAR_RE);
    const markedAt = $el.find("span.date").first().text().trim();

    items.push({
      doubanId: (href.match(/subject\/(\d+)/) || [])[1] ?? null,
      titleCn: parts[0] ?? "",
      aliases: parts.slice(1),
      rating: ratingCls ? Number(ratingCls[1]) : null,
      year: yearMatch ? Number(yearMatch[1]) : null,
      markedAt: /^\d{4}-\d{2}-\d{2}$/.test(markedAt) ? markedAt : null,
      comment: $el.find("span.comment").first().text().replace(/\s+/g, " ").trim() || null,
      introParts,
      country: introParts.find((p) => COUNTRIES.has(p)) ?? null,
    });
  });

  return items;
}

/**
 * 从列表页 HTML 里读出条目总数。
 * 三个列表的 h1 文案各不相同且带用户名，形如
 * 「阿北看过的影视(218)」「阿北在看的电视剧(17)」「阿北想看的影视(77)」，
 * 所以不能拿「看过 + 括号」这种固定搭配去匹配，只能从 h1 里取括号中的数字。
 */
export function parseListTotal(html: string): number | null {
  const m =
    html.match(/<h1>[\s\S]{0,80}?[（(]\s*(\d+)\s*[)）]\s*<\/h1>/) ||
    html.match(/(\d+)\s*部[^<]{0,4}(?:看过|在看|想看)/);
  return m ? Number(m[1]) : null;
}

/* -------------------------------------------------------------------------- */
/*                                   详情页                                    */
/* -------------------------------------------------------------------------- */

export type SubjectDetail = {
  title: string;
  year: number | null;
  imdbId: string | null;
  genres: string[];
  directors: string[];
  /** 分钟 */
  runtime: number | null;
  releaseDate: string | null;
  /** 与解析成功同一信号：详情页必然有 #info 区块 */
  hasInfo: boolean;
};

/** `#info` 区块被压平成单行文本，便于正则抓 IMDb 等零散字段。 */
function infoTextOf($: ReturnType<typeof load>): string {
  return $("#info").text().replace(/\s+/g, " ").trim();
}

/**
 * 解析条目详情页。
 * 详情页承载列表页缺失的 IMDb / 时长 / 导演 / 类型（列表页确认无 IMDb）。
 */
export function parseSubject(html: string): SubjectDetail {
  const $ = load(html);
  const infoText = infoTextOf($);
  const runtime = $('span[property="v:runtime"]').attr("content");

  return {
    title: $('h1 span[property="v:itemreviewed"]').text().trim(),
    year: Number.parseInt($("h1 .year").text().replace(/[()]/g, ""), 10) || null,
    imdbId: (infoText.match(/IMDb:\s*(tt\d+)/i) || [])[1] ?? null,
    genres: $('span[property="v:genre"]')
      .map((_, e) => $(e).text().trim())
      .get()
      .filter(Boolean),
    directors: $('a[rel="v:directedBy"]')
      .map((_, e) => $(e).text().trim())
      .get()
      .filter(Boolean),
    runtime: runtime ? Number(runtime) || null : null,
    releaseDate: $('span[property="v:initialReleaseDate"]').first().text().trim() || null,
    hasInfo: $("#info").length > 0,
  };
}
