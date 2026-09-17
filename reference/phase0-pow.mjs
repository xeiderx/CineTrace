#!/usr/bin/env node
/**
 * Phase 0 补充验证 2（修正版）：跟随 302 -> sec.douban.com -> 解 PoW -> POST /c -> 重取详情页
 */
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USER = process.env.DOUBAN_USER || '';
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
  get size() {
    return this.map.size;
  }
}

const jar = new Jar();

async function req(url, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
    ...init,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://movie.douban.com/',
      ...(jar.header() ? { Cookie: jar.header() } : {}),
      ...(init.headers || {}),
    },
  });
  jar.absorb(res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text, url };
}

function solvePow(data, difficulty = 4) {
  const target = '0'.repeat(difficulty);
  const t0 = Date.now();
  let nonce = 0;
  while (true) {
    nonce += 1;
    const h = createHash('sha512').update(data + nonce).digest('hex');
    if (h.startsWith(target)) return { nonce, ms: Date.now() - t0, hash: h.slice(0, 16) };
  }
}

/** 完整走一遍：GET -> 302 -> 挑战页 -> PoW -> POST -> 回到目标页 */
async function fetchWithPow(targetUrl, label) {
  const log = [];
  let res = await req(targetUrl);
  log.push(`GET ${targetUrl} -> ${res.status}${res.location ? ' -> ' + res.location.slice(0, 90) : ''}`);

  // 跟随重定向链（最多 5 跳）
  let hops = 0;
  let current = res;
  while (current.status >= 300 && current.status < 400 && current.location && hops < 5) {
    hops += 1;
    const next = new URL(current.location, current.url).href;
    current = await req(next);
    const isSec = next.includes('sec.douban.com');
    log.push(`  跳转#${hops} -> ${current.status} ${isSec ? '(sec.douban.com 风控页)' : ''} len=${current.text.length}`);
  }

  const $ = load(current.text);
  const tok = $('#tok').attr('value');
  if (!tok) {
    log.push('  未发现 PoW 挑战表单');
    return { res: current, pow: false, log };
  }

  const cha = $('#cha').attr('value');
  const red = $('#red').attr('value');
  const formAction = new URL($('#sec').attr('action') || '/c', current.url).href;
  const difficulty = 4;
  const solved = solvePow(cha, difficulty);
  log.push(`  解 PoW: difficulty=${difficulty} nonce=${solved.nonce} 耗时=${solved.ms}ms`);

  const posted = await req(formAction, {
    method: 'POST',
    body: new URLSearchParams({ tok, cha, sol: String(solved.nonce), red }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://sec.douban.com',
      Referer: current.url,
    },
  });
  log.push(`  POST ${formAction} -> ${posted.status}${posted.location ? ' -> ' + posted.location.slice(0, 90) : ''}  cookie数=${jar.size}`);

  // 回跳
  let after = posted;
  let h2 = 0;
  while (after.status >= 300 && after.status < 400 && after.location && h2 < 5) {
    h2 += 1;
    after = await req(new URL(after.location, after.url).href);
    log.push(`  回跳#${h2} -> ${after.status} len=${after.text.length}`);
  }
  if (after.status === 200 && after.text.length < 5000 && !/id="info"/.test(after.text)) {
    after = await req(targetUrl);
    log.push(`  主动重取目标页 -> ${after.status} len=${after.text.length}`);
  }

  log.push(`  最终状态=${after.status} 长度=${after.text.length} 含#info=${/id="info"/.test(after.text)}`);
  return { res: after, pow: true, solved, log };
}

async function parseSubject(res) {
  const $ = load(res.text);
  const infoText = $('#info').text().replace(/\s+/g, ' ').trim();
  return {
    title: $('h1 span[property="v:itemreviewed"]').text().trim(),
    year: parseInt($('h1 .year').text().replace(/[()]/g, ''), 10) || null,
    imdb: (infoText.match(/IMDb:\s*(tt\d+)/i) || [])[1] || null,
    genres: $('span[property="v:genre"]').map((_, e) => $(e).text().trim()).get(),
    directors: $('a[rel="v:directedBy"]').map((_, e) => $(e).text().trim()).get(),
    runtime: $('span[property="v:runtime"]').attr('content'),
    releaseDate: $('span[property="v:initialReleaseDate"]').first().text().trim(),
    countries: $('#info span[property="v:initialReleaseDate"]').length,
    infoSample: infoText.slice(0, 300),
    hasInfo: $('#info').length > 0,
  };
}

async function main() {
  console.log('PoW 挑战验证（跟随 302）  ' + new Date().toLocaleString());
  console.log('='.repeat(74));

  const target = 'https://movie.douban.com/subject/27140433/';
  const { res, pow, solved, log } = await fetchWithPow(target, 'subject');
  log.forEach((l) => console.log(l));

  await mkdir(join(OUT, 'raw'), { recursive: true });
  await writeFile(join(OUT, 'raw', 'pow-final-subject.html'), res.text, 'utf8');

  const parsed = await parseSubject(res);
  console.log('\n解析结果:');
  console.log(`  标题   = ${parsed.title || '(空)'}`);
  console.log(`  年份   = ${parsed.year ?? '(空)'}`);
  console.log(`  IMDb   = ${parsed.imdb || '(未找到)'}`);
  console.log(`  类型   = ${parsed.genres.join(' / ') || '(空)'}`);
  console.log(`  导演   = ${parsed.directors.join(' / ') || '(空)'}`);
  console.log(`  片长   = ${parsed.runtime || '(空)'} 分钟`);
  console.log(`  上映   = ${parsed.releaseDate || '(空)'}`);
  console.log(`  #info  = ${parsed.infoSample || '(空)'}`);

  const ok = !!parsed.title && parsed.hasInfo;
  console.log(`\n结论: ${ok ? '[PASS] PoW 可破解，详情页可正常解析' : '[FAIL] 详情页仍不可用'}`);

  // 会话持久性：同一 cookie 再抓一条
  let persist = null;
  if (ok) {
    await sleep(5000);
    console.log('\n[追加验证] 复用同一 cookie 再抓一条（肖申克的救赎 1292052）');
    const second = await req('https://movie.douban.com/subject/1292052/');
    const s2 = await parseSubject({ text: second.text });
    const powAgain = /id="tok"/.test(second.text);
    persist = { status: second.status, title: s2.title, imdb: s2.imdb, powAgain };
    console.log(`  status=${second.status} 标题=${s2.title || '(空)'} IMDb=${s2.imdb || '(未找到)'} 再次触发PoW=${powAgain}`);
    console.log(`  -> ${!powAgain && s2.title ? '[PASS] 会话持久，2100 条无需逐条解 PoW' : '[WARN] 每条都需重新解 PoW'}`);

    await sleep(5000);
    console.log('\n[追加验证] 列表页第 4 页是否仍稳定（PoW 是否波及列表页）');
    const list = await req(`https://movie.douban.com/people/${USER}/collect?sort=time&start=45`);
    const $l = load(list.text);
    const n = $l('div.item').length;
    console.log(`  status=${list.status} 条目数=${n} 触发PoW=${/id="tok"/.test(list.text)}`);
    persist.listPageUnaffected = n > 0;
  }

  await writeFile(
    join(OUT, 'pow-result.json'),
    JSON.stringify({ target, powTriggered: pow, solved, parsed, persist, log }, null, 2),
    'utf8',
  );
  console.log(`\n结果已写入 ${OUT}/pow-result.json`);
}

main();
