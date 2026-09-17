#!/usr/bin/env node
/** Phase 0 收尾：公开 RSS 交叉验证短评是否可得 */
import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USER = process.env.DOUBAN_USER || '';
const OUT = process.env.OUT_DIR || './out';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/xml,text/xml,text/html,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
}

const out = {};
console.log('RSS 短评交叉验证  ' + new Date().toLocaleString());
console.log('='.repeat(74));

for (const [name, url] of [
  ['interests', `https://www.douban.com/feed/people/${USER}/interests`],
  ['movie', `https://www.douban.com/feed/people/${USER}/interests?type=movie`],
  ['reviews', `https://www.douban.com/feed/people/${USER}/reviews`],
]) {
  try {
    const { status, text, type } = await get(url);
    await mkdir(join(OUT, 'raw'), { recursive: true });
    await writeFile(join(OUT, 'raw', `rss-${name}.xml`), text, 'utf8');
    const $ = load(text, { xmlMode: true });
    const items = $('item');
    const entries = [];
    items.each((i, el) => {
      if (i >= 3) return;
      const t = $(el).find('title').text().trim();
      const desc = $(el).find('description').text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const link = $(el).find('link').text().trim();
      const pubDate = $(el).find('pubDate').text().trim();
      entries.push({ title: t, link, pubDate, desc: desc.slice(0, 140) });
    });
    const hasRating = /推荐|力荐|还行|较差|很差|\d星/.test(text);
    const looksLikeMovie = /movie\.douban\.com\/subject/.test(text);
    out[name] = { status, contentType: type, itemCount: items.length, hasRating, looksLikeMovie, entries };
    console.log(`\n[${name}] status=${status} content-type=${(type || '').slice(0, 40)}`);
    console.log(`  item 数=${items.length} 含评语=${hasRating} 含 movie subject 链接=${looksLikeMovie}`);
    entries.forEach((e) => console.log(`    · ${e.pubDate} | ${e.title}\n      ${e.desc}`));
  } catch (e) {
    out[name] = { error: e.message };
    console.log(`\n[${name}] 失败: ${e.message}`);
  }
}

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'rss-verify.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(`\n明细已写入 ${OUT}/rss-verify.json`);
