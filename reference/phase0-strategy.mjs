#!/usr/bin/env node
/**
 * Phase 0 补充验证 6（决策性）：分层匹配策略命中率对比
 * 列表页的 title 字段实际是「中文名 / 原名 / 别名1 / 别名2」，
 * 验证：用【原名】而非中文名去搜 TMDB，能否显著提升命中率。
 * 同时验证剧集「第X季」后缀处理。
 */
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USER = process.env.DOUBAN_USER || '';
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const OUT = process.env.OUT_DIR || './out';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Jar {
  constructor() {
    this.map = new Map();
  }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}
const jar = new Jar();

function solvePow(data, d = 4) {
  const t = '0'.repeat(d);
  let n = 0;
  while (true) {
    n += 1;
    if (createHash('sha512').update(data + n).digest('hex').startsWith(t)) return n;
  }
}

async function rawGet(url) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://movie.douban.com/',
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
  });
  jar.absorb(res);
  return res;
}

async function smartGet(url) {
  let res = await rawGet(url);
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && hops < 4) {
    hops += 1;
    res = await rawGet(new URL(res.headers.get('location'), url).href);
  }
  let html = await res.text();
  const $ = load(html);
  const tok = $('#tok').attr('value');
  if (tok) {
    const cha = $('#cha').attr('value');
    const red = $('#red').attr('value');
    const action = new URL($('#sec').attr('action') || '/c', res.url || url).href;
    const nonce = solvePow(cha, 4);
    const posted = await fetch(action, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://sec.douban.com',
        Referer: res.url || url,
        ...(jar.header() ? { Cookie: jar.header() } : {}),
      },
      body: new URLSearchParams({ tok, cha, sol: String(nonce), red }),
    });
    jar.absorb(posted);
    const back = await rawGet(url);
    html = await back.text();
  }
  return html;
}

function parseListPage(html) {
  const $ = load(html);
  const items = [];
  $('div.item').each((_, el) => {
    const $el = $(el);
    const titleA = $el.find('.title a').first();
    const href = titleA.attr('href') || '';
    const rawTitle = titleA.text().replace(/\s+/g, ' ').trim();
    const parts = rawTitle.split(' / ').map((s) => s.trim());
    const ratingCls = ($el.find('span[class^="rating"]').first().attr('class') || '').match(/rating(\d)-t/);
    const intro = $el.find('li.intro').text().replace(/\s+/g, ' ').trim();
    const introParts = intro.split(' / ').map((s) => s.trim());
    const yearMatch = intro.match(/\b(19\d{2}|20\d{2})\b/);
    items.push({
      doubanId: (href.match(/subject\/(\d+)/) || [])[1],
      titleCn: parts[0],
      aliases: parts.slice(1),
      rating: ratingCls ? Number(ratingCls[1]) : null,
      year: yearMatch ? Number(yearMatch[1]) : null,
      introParts,
      // 启发式取国家：intro 中第一个匹配已知国家名的段
      country: introParts.find((p) =>
        /^(中国大陆|美国|香港|台湾|日本|韩国|法国|英国|德国|意大利|西班牙|泰国|印度|加拿大|澳大利亚|俄罗斯|瑞典|丹麦|挪威|巴西|墨西哥|阿根廷|波兰|比利时|荷兰|奥地利|瑞士|爱尔兰|新西兰|伊朗|土耳其|以色列|南非|捷克|匈牙利|希腊|葡萄牙|芬兰|冰岛|乌克兰|越南|新加坡|马来西亚|菲律宾|印度尼西亚|智利|哥伦比亚|秘鲁|罗马尼亚|保加利亚|塞尔维亚|克罗地亚|斯洛文尼亚|斯洛伐克|爱沙尼亚|拉脱维亚|立陶宛|格鲁吉亚|亚美尼亚|哈萨克斯坦|蒙古|尼泊尔|斯里兰卡|巴基斯坦|孟加拉国|缅甸|柬埔寨|老挝|文莱|卡塔尔|阿联酋|沙特阿拉伯|黎巴嫩|约旦|摩洛哥|突尼斯|阿尔及利亚|肯尼亚|尼日利亚|加纳|埃塞俄比亚|坦桑尼亚|乌干达|津巴布韦|古巴|委内瑞拉|厄瓜多尔|玻利维亚|巴拉圭|乌拉圭|哥斯达黎加|巴拿马|危地马拉|多米尼加|波多黎各|牙买加|海地|特立尼达和多巴哥|巴哈马|巴巴多斯)$/.test(p),
      ) || null,
    });
  });
  return items;
}

async function tmdb(path, params) {
  const p = new URLSearchParams({ language: 'zh-CN', api_key: TMDB_KEY, ...params });
  const res = await fetch(`https://api.themoviedb.org/3/${path}?${p}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return { results: [], error: res.status };
  const b = await res.json();
  return { results: (b.results || []).filter((r) => r.media_type !== 'person') };
}

const yearOf = (r) => Number((r?.release_date || r?.first_air_date || '').slice(0, 4)) || null;

/** 策略 A：纯中文名 + search/multi */
async function strategyA(item) {
  const { results } = await tmdb('search/multi', { query: item.titleCn });
  const first = results[0];
  return { first, yearOk: item.year && yearOf(first) ? Math.abs(yearOf(first) - item.year) <= 1 : null };
}

/** 策略 B：原名优先（title 的第 2 段，通常是原文名） + search/multi */
async function strategyB(item) {
  const orig = item.aliases.find((a) => /[a-zA-Z\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF]/.test(a) && /[a-zA-Z\u0E00-\u0E7F\u3040-\u30FF]/.test(a));
  if (!orig) return { first: null, yearOk: null, skipped: true };
  const { results } = await tmdb('search/multi', { query: orig });
  const first = results[0];
  return { first, yearOk: item.year && yearOf(first) ? Math.abs(yearOf(first) - item.year) <= 1 : null, usedQuery: orig };
}

/** 策略 C：中文名去「第X季」+ search/tv，并用 season 校验 */
async function strategyC(item) {
  const m = item.titleCn.match(/^(.*?)(?:第\s*([一二三四五六七八九十\d]+)\s*季)?$/);
  const base = (m?.[1] || item.titleCn).trim();
  const season = m?.[2] ? Number(m[2].replace(/[一二三四五六七八九十]/g, (s) => '一二三四五六七八九十'.indexOf(s) + 1)) : null;
  if (!season) return { first: null, yearOk: null, skipped: true };
  const { results } = await tmdb('search/tv', { query: base });
  const first = results[0];
  let seasonOk = null;
  if (first) {
    try {
      const p = new URLSearchParams({ language: 'zh-CN', api_key: TMDB_KEY });
      const r = await fetch(`https://api.themoviedb.org/3/tv/${first.id}/season/${season}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      seasonOk = r.ok;
    } catch {
      seasonOk = false;
    }
  }
  return { first, yearOk: null, seasonOk, usedQuery: base };
}

async function main() {
  console.log('分层匹配策略对比  ' + new Date().toLocaleString());
  console.log('='.repeat(78));

  console.log('\n[1] 抓取样本（4 页）');
  let items = [];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await sleep(5000);
    const html = await smartGet(`https://movie.douban.com/people/${USER}/collect?sort=time&start=${i * 15}`);
    items = items.concat(parseListPage(html));
  }
  console.log(`  合计 ${items.length} 条`);
  console.log(`  含别名/原名 ${items.filter((x) => x.aliases.length).length} 条`);
  console.log(`  含季数标识 ${items.filter((x) => /第\s*[一二三四五六七八九十\d]+\s*季/.test(x.titleCn)).length} 条`);
  console.log(`  国家可识别 ${items.filter((x) => x.country).length} 条`);
  console.log('  样例（中文名 | 别名/原名）:');
  items.slice(0, 5).forEach((x) => console.log(`    ${x.titleCn.padEnd(16)} | ${x.aliases.slice(0, 2).join(' / ') || '(无)'}`));

  console.log('\n[2] 策略对比');
  const compare = [];
  for (const item of items) {
    const a = await strategyA(item);
    await sleep(200);
    const b = await strategyB(item);
    await sleep(200);
    const c = await strategyC(item);
    await sleep(200);
    compare.push({
      doubanId: item.doubanId,
      titleCn: item.titleCn,
      aliases: item.aliases,
      doubanYear: item.year,
      country: item.country,
      A: { title: a.first?.title || a.first?.name || null, year: yearOf(a.first), id: a.first?.id, type: a.first?.media_type, yearOk: a.yearOk },
      B: { title: b.first?.title || b.first?.name || null, year: yearOf(b.first), id: b.first?.id, type: b.first?.media_type, yearOk: b.yearOk, query: b.usedQuery, skipped: !!b.skipped },
      C: { title: c.first?.name || null, id: c.first?.id, query: c.usedQuery, seasonOk: c.seasonOk, skipped: !!c.skipped },
    });
  }

  const pct = (n, d) => `${n}/${d} (${Math.round((n / d) * 100)}%)`;
  const aHit = compare.filter((x) => x.A.title).length;
  const aYearOk = compare.filter((x) => x.A.title && x.A.yearOk !== false).length;
  const bTested = compare.filter((x) => !x.B.skipped);
  const bHit = bTested.filter((x) => x.B.title).length;
  const bYearOk = bTested.filter((x) => x.B.title && x.B.yearOk !== false).length;
  const cTested = compare.filter((x) => !x.C.skipped);
  const cHit = cTested.filter((x) => x.C.title).length;
  const cSeasonOk = cTested.filter((x) => x.C.seasonOk).length;

  console.log(`  A 纯中文名 search/multi        : 有结果 ${pct(aHit, compare.length)}  年份核对通过 ${pct(aYearOk, compare.length)}`);
  console.log(`  B 原名优先 search/multi        : 有结果 ${pct(bHit, bTested.length)}  年份核对通过 ${pct(bYearOk, bTested.length)}  (可测 ${bTested.length} 条)`);
  console.log(`  C 去季数 + search/tv + season 校验: 有结果 ${pct(cHit, cTested.length)}  季存在 ${pct(cSeasonOk, cTested.length)}  (可测 ${cTested.length} 条)`);

  const aMiss = compare.filter((x) => !x.A.title);
  const bFix = aMiss.filter((x) => x.B.title);
  const cOnly = compare.filter((x) => x.C.title && (!x.A.title || x.A.yearOk === false));
  console.log(`\n  A 失败的 ${aMiss.length} 条中，B 救回 ${bFix.length} 条`);
  console.log(`  需走剧集路径(C)的 ${cTested.length} 条中，C 命中 ${cHit} 条`);
  console.log(`\n  最终估算：A ∪ B ∪ C 覆盖率 ≈ ${Math.round(((aYearOk + bFix.length + (cOnly.length - bFix.filter((x) => cOnly.includes(x)).length)) / compare.length) * 100)}%`);

  console.log('\n  明细（前 22）:  A=纯中文名 B=原名 C=剧集');
  compare.slice(0, 22).forEach((x) => {
    const am = x.A.title ? (x.A.yearOk === false ? 'A~' : 'A+') : 'A-';
    const bm = x.B.skipped ? 'B ' : x.B.title ? (x.B.yearOk === false ? 'B~' : 'B+') : 'B-';
    const cm = x.C.skipped ? 'C ' : x.C.title ? 'C+' : 'C-';
    console.log(`    ${am}${bm}${cm}  豆瓣[${x.doubanYear || '----'}] ${x.titleCn.slice(0, 18).padEnd(19)} -> ${(x.A.title || x.B.title || x.C.title || '-').slice(0, 24)}`);
  });

  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, 'strategy-compare.json'),
    JSON.stringify(
      {
        sampleCount: compare.length,
        summary: {
          A: { tested: compare.length, hit: aHit, yearOk: aYearOk },
          B: { tested: bTested.length, hit: bHit, yearOk: bYearOk },
          C: { tested: cTested.length, hit: cHit, seasonOk: cSeasonOk },
          A_miss: aMiss.length,
          A_miss_fixedByB: bFix.length,
        },
        compare,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n明细已写入 ${OUT}/strategy-compare.json`);
}

main();
