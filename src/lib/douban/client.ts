import { createHash } from "node:crypto";
import { load } from "cheerio";
import { EnvHttpProxyAgent, fetch, type Headers as UndiciHeaders } from "undici";

/**
 * 豆瓣抓取客户端：Cookie 会话、手动跟随重定向、工作量证明（PoW）校验处理。
 * 是 Phase 3 所有豆瓣请求的唯一入口。
 */

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_REDIRECT_HOPS = 5;
const POW_DIFFICULTY = 4;

/**
 * 代理分流。NAS 在国内，豆瓣与 TMDB 都需要合理出口。
 * 必须用 undici 的 fetch —— Node 全局 fetch 不认 dispatcher 参数。
 * noProxy 传 undefined 时 undici 自行回落到 NO_PROXY 环境变量。
 */
const dispatcher = new EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY });

/* -------------------------------------------------------------------------- */
/*                                  Cookie Jar                                */
/* -------------------------------------------------------------------------- */

/**
 * 极简 Cookie 容器。豆瓣的会话 Cookie 需要在一次同步周期内持续复用，
 * 会话建立后绝大多数条目无需再走校验流程。
 */
export class Jar {
  private map = new Map<string, string>();

  /** 吸收一次响应里所有的 Set-Cookie（用 getSetCookie 逐条返回，不会被合并）。 */
  absorb(res: { headers: UndiciHeaders }): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/** 进程内单例：整个同步周期共用一个会话。 */
export const jar = new Jar();

/* -------------------------------------------------------------------------- */
/*                                   请求                                      */
/* -------------------------------------------------------------------------- */

export type DoubanResponse = {
  status: number;
  location: string | null;
  text: string;
  url: string;
};

export type RequestOptions = {
  method?: string;
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
};

/**
 * 发起一次请求并读全文本。
 * redirect 固定为 manual：重定向链要手动跟随，才能在中间识别中间页。
 */
export async function req(url: string, init: RequestOptions = {}): Promise<DoubanResponse> {
  const cookie = jar.header();
  const res = await fetch(url, {
    dispatcher,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: init.method,
    body: init.body,
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: "https://movie.douban.com/",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });

  jar.absorb(res);
  const text = await res.text();
  return {
    status: res.status,
    location: res.headers.get("location"),
    text,
    url,
  };
}

/* -------------------------------------------------------------------------- */
/*                               PoW 校验处理                                  */
/* -------------------------------------------------------------------------- */

export type PowSolution = { nonce: number; ms: number; hash: string };

/**
 * 搜索满足条件的 nonce，使 sha512(cha + nonce) 的十六进制以 difficulty 个 "0" 开头。
 * 计算量很小，不构成性能瓶颈。
 */
export function solvePow(data: string, difficulty = POW_DIFFICULTY): PowSolution {
  const target = "0".repeat(difficulty);
  const t0 = Date.now();
  let nonce = 0;
  for (;;) {
    nonce += 1;
    const hash = createHash("sha512").update(data + nonce).digest("hex");
    if (hash.startsWith(target)) {
      return { nonce, ms: Date.now() - t0, hash: hash.slice(0, 16) };
    }
  }
}

export type PowFetchResult = {
  res: DoubanResponse;
  /** 是否真的走了 PoW 流程 */
  pow: boolean;
  solved?: PowSolution;
};

/**
 * 完整走一遍：GET → 跟随 302 → 中间页 → 提交 PoW 校验 → 回跳 → 目标内容。
 * 列表页不涉及该流程，只有详情页需要走这里。
 */
export async function fetchWithPow(targetUrl: string): Promise<PowFetchResult> {
  const first = await req(targetUrl);

  let current = first;
  let hops = 0;
  while (
    current.status >= 300 &&
    current.status < 400 &&
    current.location &&
    hops < MAX_REDIRECT_HOPS
  ) {
    hops += 1;
    current = await req(new URL(current.location, current.url).href);
  }

  const $ = load(current.text);
  const tok = $("#tok").attr("value");
  if (!tok) return { res: current, pow: false };

  const cha = $("#cha").attr("value") ?? "";
  const red = $("#red").attr("value") ?? "";
  const formAction = new URL($("#sec").attr("action") || "/c", current.url).href;
  const solved = solvePow(cha, POW_DIFFICULTY);

  const posted = await req(formAction, {
    method: "POST",
    body: new URLSearchParams({ tok, cha, sol: String(solved.nonce), red }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://sec.douban.com",
      Referer: current.url,
    },
  });

  let after = posted;
  let backHops = 0;
  while (
    after.status >= 300 &&
    after.status < 400 &&
    after.location &&
    backHops < MAX_REDIRECT_HOPS
  ) {
    backHops += 1;
    after = await req(new URL(after.location, after.url).href);
  }

  // 兜底：回跳后偶尔会拿到 200 但内容残缺的页面（不是错误码，极易误判为解析失败）
  if (after.status === 200 && after.text.length < 5000 && !/id="info"/.test(after.text)) {
    after = await req(targetUrl);
  }

  return { res: after, pow: true, solved };
}

/* -------------------------------------------------------------------------- */
/*                              页面状态判定                                    */
/* -------------------------------------------------------------------------- */

/** 页面处于受限状态：命中后应中止本轮，继续请求只会让情况变差。 */
export function isBlocked(html: string): boolean {
  return /sec\.douban\.com|异常请求|行为异常|请输入验证码|captcha/i.test(html);
}

/** 登录态失效：页面里没有 subject 链接才成立（有链接说明只是局部文案）。 */
export function needsLogin(html: string): boolean {
  return /passport\.douban|登录后可见/.test(html) && !/subject\//.test(html);
}
