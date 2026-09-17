#!/usr/bin/env node
/**
 * Phase 0 可行性验证脚本（一次性，验证完可删）
 * 验证三条链路：豆瓣 HTML 列表页 / 豆瓣 Frodo API / TMDB
 * 用法：
 *   DOUBAN_USER=xxx TMDB_API_KEY=xxx node phase0-verify.mjs
 */
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USER = process.env.DOUBAN_USER || '';
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN || '';
const FRODO_KEY = process.env.FRODO_APIKEY || '0dad551ec0f84ed02907ff5c42e8ec70';
const FRODO_SECRET = process.env.FRODO_SECRET || 'bf7dddc7c9cfe6f7';
const OUT = process.env.OUT_DIR || './out';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const report = { startedAt: new Date().toISOString(), tests: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mark(name, ok, note, extra = {}) {
  report.tests[name] = { ok, note, ...extra };
  console.log(`  ${ok ? '[PASS]' : '[FAIL]'}  ${name}${note ? '  | ' + note : ''}`);
}

async function req(url, { timeout = 25000, ...init } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), ...init });
    const text = await res.text();
    return { ok: true, status: res.status, headers: res.headers, text, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: `${e.name}: ${e.message}`, ms: Date.now() - t0 };
  }
}

function cookiesOf(res) {
  try {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return list.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  } catch {
    return '';
  }
}

async function loadCheerio() {
  try {
    return (await import('cheerio')).load;
  } catch {
    return null;
  }
}

function parseCollect(html, load) {
  const out = [];
  if (load) {
    const $ = load(html);
    $('.item').each((_, el) => {
      const a = $(el).find('.title a, .info a').first();
      const href = a.attr('href') || '';
      const id = (href.match(/subject\/(\d+)/) || [])[1];
      if (!id) return;
      const r = $(el).find('.rating').first();
      out.push({
        doubanId: id,
        title: a.text().replace(/\s+/g, ' ').trim(),
        markedAt: ($(el).find('.date').first().text() || '').trim(),
        ratingRaw: (r.attr('title') || r.text() || '').trim(),
        comment: ($(el).find('.comment, .short').first().text() || '').replace(/\s+/g, ' ').trim(),
      });
    });
    if (out.length) return out;
  }
  // 无 cheerio 时的正则兜底
  const re = /href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/?"[^>]*>([^<]*)<\/a>/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ doubanId: m[1], title: m[2].trim(), markedAt: '', ratingRaw: '', comment: '' });
  }
  return out;
}

async function testDoubanHtml() {
  console.log('\n[1/3] 豆瓣 HTML 列表页');
  if (!USER) return mark('douban.html', false, '未设置 DOUBAN_USER');

  // 预热：拿 bid 等 cookie
  const warm = await req('https://movie.douban.com/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  const cookie = warm.ok ? cookiesOf(warm) : '';
  console.log(`  预热 movie.douban.com -> ${warm.ok ? warm.status : warm.error}  cookie=${cookie || '(空)'}`);

  const pages = [];
  for (const start of [0, 15]) {
    const url = `https://movie.douban.com/people/${encodeURIComponent(USER)}/collect?sort=time&start=${start}`;
    const res = await req(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://movie.douban.com/',
        'Upgrade-Insecure-Requests': '1',
        Connection: 'keep-alive',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    if (!res.ok) {
      mark(`douban.html.start${start}`, false, res.error);
      continue;
    }

    const html = res.text;
    await mkdir(join(OUT, 'raw'), { recursive: true });
    await writeFile(join(OUT, 'raw', `douban-collect-start${start}.html`), html, 'utf8');

    const blocked = /sec\.douban\.com|异常请求|行为异常|请输入验证码|captcha/i.test(html);
    const needLogin = /passport\.douban|登录后可见/.test(html) && !/subject\//.test(html);
    const items = parseCollect(html, await loadCheerio());
    const totalMatch = html.match(/看过\s*[（(]\s*(\d+)\s*[)）]/) || html.match(/(\d+)\s*部看过/);

    mark(
      `douban.html.start${start}`,
      res.status === 200 && items.length > 0 && !blocked,
      `status=${res.status} items=${items.length} ${res.ms}ms  blocked=${blocked} needLogin=${needLogin} 页面显示总数=${totalMatch?.[1] ?? '?'}`,
      { blocked, needLogin, items },
    );

    if (start === 0 && items.length) {
      const f = items[0];
      const plain = html.replace(/<[^>]+>/g, ' ');
      mark(
        'douban.html.fields',
        true,
        `标题=true ID=true 标记日期=${!!f.markedAt} 评分=${!!f.ratingRaw} 短评=${!!f.comment}`,
        { sample: items.slice(0, 3) },
      );
      mark(
        'douban.html.imdbInList',
        /tt\d{7,}/.test(plain),
        /tt\d{7,}/.test(plain)
          ? '列表页 HTML 中疑似含 IMDb ID（可直接用于 /find）'
          : '列表页无 IMDb ID（确认需要详情页，符合预期）',
      );
    }
    pages.push(items.map((i) => i.doubanId));
    await sleep(4000);
  }

  if (pages.length === 2 && pages[0].length && pages[1].length) {
    const overlap = pages[0].filter((id) => pages[1].includes(id));
    mark(
      'douban.html.pagination',
      pages[1].length > 0,
      `第1页=${pages[0].length}条 第2页=${pages[1].length}条 重叠=${overlap.length}条`,
      { page1: pages[0], page2: pages[1] },
    );
  }
  return pages;
}

function frodoSign(pathQuery, ts, secret) {
  const raw = `GET&${encodeURIComponent(pathQuery)}&${ts}`;
  return createHmac('sha1', secret).update(raw).digest('base64');
}

async function testFrodo() {
  console.log('\n[2/3] 豆瓣 Frodo API');
  if (!USER) return mark('douban.frodo', false, '未设置 DOUBAN_USER');

  const pathBase = `/api/v2/user/${USER}/interests`;
  const tsVariants = [
    { name: 'ts-epoch', ts: String(Math.floor(Date.now() / 1000)) },
    { name: 'ts-datetime', ts: new Date().toISOString().slice(0, 19).replace('T', ' ') },
  ];

  for (const v of tsVariants) {
    const q = `type=movie&status=done&start=0&count=20&for_mobile=1&apikey=${FRODO_KEY}&_ts=${encodeURIComponent(v.ts)}`;
    const pathQuery = `${pathBase}?${q}`;
    const sig = frodoSign(pathQuery, v.ts, FRODO_SECRET);
    const url = `https://frodo.douban.com${pathQuery}&_sig=${encodeURIComponent(sig)}`;

    const res = await req(url, {
      headers: {
        'User-Agent': `api-client/1 com.douban.frodo/7.18.1(231) Android/29 product/perseus vendor/Xiaomi model/Mi MIX 3 rom/miui6 network/wifi platform/mobile nd/1`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      mark(`douban.frodo.${v.name}`, false, res.error);
      continue;
    }

    let body = null;
    try {
      body = JSON.parse(res.text);
    } catch {}

    const code = body?.code;
    if (code === 996) {
      mark(`douban.frodo.${v.name}`, false, 'code=996 签名错误（密钥已轮换或签名算法变更）');
      continue;
    }

    const list = body?.interests || [];
    const rawKeys = list[0] ? Object.keys(list[0]) : Object.keys(body || {});
    mark(
      `douban.frodo.${v.name}`,
      res.status === 200 && list.length > 0,
      `status=${res.status} total=${body?.total ?? '?'} items=${list.length} ${res.ms}ms  code=${code ?? '-'}`,
      { total: body?.total, rawKeys, sample: list.slice(0, 2) },
    );

    await mkdir(join(OUT, 'raw'), { recursive: true });
    await writeFile(join(OUT, 'raw', `frodo-${v.name}.json`), res.text, 'utf8');

    if (list.length) {
      const s = list[0];
      const flat = JSON.stringify(s);
      mark(
        'douban.frodo.fieldCoverage',
        true,
        `含 my_rating=${/rating/.test(flat)} 含 comment/短评=${/comment/.test(flat)} 含日期=${/create_time|update_time|date/.test(flat)} 含IMDb=${/tt\d{7,}/.test(flat)} 含年份=${/"year"/.test(flat)}`,
        { subjectTopLevelKeys: s.subject ? Object.keys(s.subject) : [], subjectType: s.subject?.type },
      );
      return body?.total;
    }
    await sleep(3000);
  }
  return 0;
}

async function testTmdb() {
  console.log('\n[3/3] TMDB 连通性');
  if (!TMDB_KEY && !TMDB_TOKEN) return mark('tmdb', false, '未设置 TMDB_API_KEY 或 TMDB_ACCESS_TOKEN');

  const auth = TMDB_TOKEN ? { Authorization: `Bearer ${TMDB_TOKEN}` } : {};
  const base = 'https://api.themoviedb.org/3';
  const withKey = (u) => (TMDB_KEY ? `${u}${u.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}` : u);

  const cases = [
    ['tmdb.search.movie', withKey(`${base}/search/movie?query=${encodeURIComponent('教父')}&year=1972&language=zh-CN`)],
    ['tmdb.search.multi', withKey(`${base}/search/multi?query=${encodeURIComponent('狂飙')}&language=zh-CN`)],
    ['tmdb.find.imdb', withKey(`${base}/find/tt0068646?external_source=imdb_id&language=zh-CN`)],
    ['tmdb.configuration', withKey(`${base}/configuration`)],
  ];

  for (const [name, url] of cases) {
    const res = await req(url, { headers: { Accept: 'application/json', ...auth } });
    if (!res.ok) {
      mark(name, false, res.error);
      continue;
    }
    let body = null;
    try {
      body = JSON.parse(res.text);
    } catch {}
    const rs = body?.results || body?.movie_results || [];
    const extra =
      name === 'tmdb.search.multi'
        ? `媒体类型=${[...new Set(rs.map((r) => r.media_type))].join(',') || '-'}`
        : name === 'tmdb.find.imdb'
          ? `movie=${body?.movie_results?.length ?? 0} tv=${body?.tv_results?.length ?? 0}`
          : name === 'tmdb.configuration'
            ? `poster_sizes=${(body?.images?.poster_sizes || []).slice(0, 4).join(',')}`
            : `首条=${rs[0]?.title || rs[0]?.name || '-'}`;
    mark(name, res.status === 200, `status=${res.status} results=${rs.length} ${res.ms}ms  ${extra}`, {
      first: rs[0] || null,
    });
    await sleep(400);
  }

  const img = await req('https://image.tmdb.org/t/p/w342/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  mark('tmdb.image.host', img.ok && img.status === 200, `status=${img.status} ${img.ms}ms`);

  const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  mark(
    'tmdb.proxy',
    !proxyEnv,
    proxyEnv ? `检测到代理环境变量 ${proxyEnv}（脚本未自动套用）` : '未检测到代理环境变量',
  );
}

async function main() {
  console.log('Phase 0 可行性验证  ' + new Date().toLocaleString());
  console.log('='.repeat(72));
  await testDoubanHtml();
  await sleep(5000);
  await testFrodo();
  await sleep(2000);
  await testTmdb();

  console.log('\n' + '='.repeat(72));
  const t = report.tests;
  const frodoOk = t['douban.frodo.ts-epoch']?.ok || t['douban.frodo.ts-datetime']?.ok;
  const htmlOk = t['douban.html.start0']?.ok;
  report.decision = {
    历史导入源: frodoOk ? 'Frodo API' : htmlOk ? 'HTML 全量遍历' : '需转为 CSV 导入',
    日常增量源: htmlOk ? 'HTML 列表页增量' : frodoOk ? 'Frodo API 增量' : '需转为 CSV / 手工',
    TMDB: t['tmdb.search.movie']?.ok ? '直连可用' : '需要配置代理',
    海报CDN: t['tmdb.image.host']?.ok ? '可达' : '不可达（海报墙需另找图源或走代理）',
  };
  console.log('建议决策:');
  for (const [k, v] of Object.entries(report.decision)) console.log(`  ${k.padEnd(12)} -> ${v}`);

  report.finishedAt = new Date().toISOString();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n报告已写入 ${join(OUT, 'report.json')}`);
}

main();
