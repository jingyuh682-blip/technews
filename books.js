/**
 * 科技图书洞察：抓取 AI 相关参考书目 → DeepSeek 品类观察与策划方向
 * 不限「计算机/网络」类目，凡与人工智能/大模型等相关即可
 * crontab: 0 9 * * 1（每周一）
 */
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const similarity = require('string-similarity');
const { readDay, todayKey, saveBooks, findLatestBooks } = require('./store');
const { chat, extractJson, getApiKey } = require('./llm');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** 搜索词：面向 AI，不绑死计算机类目 */
const AI_QUERIES = [
  '人工智能',
  '大模型',
  'ChatGPT',
  'AIGC',
  '深度学习',
  '机器学习',
  'DeepSeek',
  '智能体',
  '提示词',
  '具身智能'
];

/**
 * 书名需命中 AI 相关信号（教育/经管/办公等类目的 AI 书也保留）
 * 故意不含单纯的「计算机/网络/编程/前端」以免收进通用 CS 书
 */
const AI_TITLE_RE =
  /人工智能|大模型|生成式|深度学|机器学|神经网|ChatGPT|GPT-?\d|AIGC|LLM|Transformer|智能体|\bAgent\b|Prompt|提示词|提示工程|具身智能|强化学习|RLHF|多模态|扩散模型|Stable\s*Diffusion|Midjourney|Sora|Claude|Gemini|DeepSeek|豆包|通义|文心|Kimi|讯飞|OpenAI|自动驾驶|人机协作|AI\s*绘画|AI\s*写作|AI\s*办公|AI\s*产品|AI\s*时代|这就是\s*AI|\bAI\b/i;

const TECH_QUERIES = AI_QUERIES;
const TECH_TITLE_RE = AI_TITLE_RE;

let cloudscraper = null;
try {
  cloudscraper = require('cloudscraper');
} catch (_e) {
  cloudscraper = null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 可选：导出浏览器登录 Cookie，显著提高京东/淘宝/抖音爬取成功率 */
function platformCookie(platform) {
  const env = {
    jd: process.env.JD_COOKIE || process.env.BOOKS_JD_COOKIE || '',
    taobao: process.env.TAOBAO_COOKIE || process.env.BOOKS_TAOBAO_COOKIE || '',
    douyin: process.env.DOUYIN_COOKIE || process.env.BOOKS_DOUYIN_COOKIE || ''
  };
  return String(env[platform] || '').trim();
}

function looksGarbled(title) {
  const t = String(title || '');
  if (!t) return true;
  const bad = (t.match(/\uFFFD/g) || []).length;
  if (bad >= 2) return true;
  if (bad >= 1 && t.length < 8) return true;
  const weird = (t.match(/[\u0080-\u00FF\u0400-\u04FF]/g) || []).length;
  if (weird >= 3 && !/[\u4e00-\u9fff]/.test(t)) return true;
  return false;
}

function decodeHtmlBuffer(buf, contentType) {
  const ct = String(contentType || '').toLowerCase();
  let encoding = 'utf-8';
  const m = ct.match(/charset=([^\s;]+)/i);
  if (m) encoding = m[1].replace(/["']/g, '').toLowerCase();
  if (encoding === 'gb2312' || encoding === 'gbk' || encoding === 'gb18030') {
    return iconv.decode(buf, 'gb18030');
  }
  let text = buf.toString('utf8');
  if ((text.match(/\uFFFD/g) || []).length >= 3 || /charset=gb/i.test(text.slice(0, 800))) {
    text = iconv.decode(buf, 'gb18030');
  }
  return text;
}

async function fetchRawBuffer(url, timeoutMs = 20000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...extraHeaders
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url, timeoutMs = 20000, extraHeaders = {}) {
  // 当当等 GBK 站点走原生 fetch + iconv，避免 cloudscraper 乱码导致解析为 0
  const preferBinary = /dangdang\.com|bookschina\.com/i.test(url);
  if (!preferBinary && cloudscraper) {
    try {
      const html = await cloudscraper.get({
        uri: url,
        timeout: timeoutMs,
        headers: {
          'User-Agent': extraHeaders['User-Agent'] || UA,
          Accept: 'text/html,application/xhtml+xml,application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...extraHeaders
        }
      });
      const text = String(html || '');
      if (text && !looksGarbled(text.slice(0, 80))) return text;
    } catch (_e) {
      /* fall through */
    }
  }
  const { buf, contentType } = await fetchRawBuffer(url, timeoutMs, extraHeaders);
  return decodeHtmlBuffer(buf, contentType);
}

async function fetchJson(url, timeoutMs = 20000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA_MOBILE,
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...extraHeaders
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 解析销量代理文本为可比数字 */
function parseSalesNum(raw) {
  const s = String(raw || '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!s) return 0;
  let m = s.match(/([\d.]+)\s*万\+?/);
  if (m) return Math.round(Number(m[1]) * 10000);
  m = s.match(/([\d.]+)\s*w/i);
  if (m) return Math.round(Number(m[1]) * 10000);
  m = s.match(/([\d.]+)/);
  if (m) return Math.round(Number(m[1]));
  return 0;
}

function formatSalesNum(n) {
  if (!n || n <= 0) return '';
  if (n >= 10000) {
    const v = n / 10000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}万`;
  }
  return String(n);
}

function normalizeSales(raw, rank) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return `榜单第${rank || '-'}名`;
  const m =
    s.match(/([\d.]+万?\+?)\s*条评论/) ||
    s.match(/([\d.]+万?\+?)人(?:评价|付款|买过|想买)/) ||
    s.match(/已售\s*([\d.]+万?\+?)/) ||
    s.match(/销量[:：]?\s*([\d.]+万?\+?)/);
  if (m) {
    const n = parseSalesNum(m[1]);
    if (n) return `${formatSalesNum(n)}人气`;
    return `${m[1]}人气`;
  }
  const m2 = s.match(/(\d[\d,]*)\s*条评论/);
  if (m2) return `${m2[1]}条评论`;
  const m3 = s.match(/(\d[\d,]*)/);
  if (m3 && /评论|推荐|评价|付款|已售/.test(s)) return `${m3[1]}条评论`;
  s = s.replace(/(100%推荐)+/g, '').trim();
  if (s.length > 28) s = s.slice(0, 28) + '…';
  return s || `榜单第${rank || '-'}名`;
}

function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(
      /第[一二三四五六七八九十\d]+版|修订版|典藏版|精装|平装|彩印|上下册|套装|全集|全彩|图解|中文版|英文版/g,
      ''
    )
    .replace(/[^\u4e00-\u9fffa-z0-9]/gi, '')
    .slice(0, 28);
}

function makeBook(partial) {
  const salesRaw = partial.sales || '';
  const salesNum = partial.salesNum != null ? Number(partial.salesNum) : parseSalesNum(salesRaw);
  return {
    title: String(partial.title || '').slice(0, 120),
    author: String(partial.author || '').slice(0, 80),
    category: partial.category || '人工智能',
    platform: partial.platform,
    rank: partial.rank || 0,
    sales: normalizeSales(salesRaw, partial.rank),
    salesNum: salesNum || 0,
    url: partial.url || '',
    sourceOk: true
  };
}

async function fetchDangdang() {
  const books = [];
  // 01.54.92 = 人工智能子类；另用全站关键词搜索，不限计算机/网络大类
  const urls = [
    'http://bang.dangdang.com/books/bestsellers/01.54.92.00.00.00-recent7-0-0-1-1',
    'http://bang.dangdang.com/books/bestsellers/01.54.92.00.00.00-24hours-0-0-1-1',
    'http://bang.dangdang.com/books/newhotsales/01.54.92.00.00.00-24hours-0-0-1-1',
    'http://bang.dangdang.com/books/bestsellers/01.54.92.00.00.00-month-0-0-1-1'
  ];
  for (const q of AI_QUERIES.slice(0, 6)) {
    urls.push(`http://search.dangdang.com/?key=${encodeURIComponent(q)}&act=input`);
  }
  for (const url of urls) {
    try {
      const html = await fetchHtml(url, 20000, { Referer: 'http://www.dangdang.com/' });
      const $ = cheerio.load(html);
      const nodes = $('ul.bang_list li, .bang_list_box li, li[class*="line"], ul.bigimg li, li[ddt-pit]');
      nodes.each((i, el) => {
        if (books.length >= 80) return;
        const title =
          $(el).find('div.name a, .name a, a[title], a.pic').first().attr('title') ||
          $(el).find('div.name a, .name a, p.name a').first().text().trim();
        const author = $(el).find('div.publisher_info a, .publisher_info, p.search_book_author').first().text().trim();
        const link = $(el).find('div.name a, .name a, p.name a').first().attr('href') || '';
        if (!title || looksGarbled(title)) return;
        if (!AI_TITLE_RE.test(title)) return;
        const star = $(el).find('span.tuijian, .star, .pinglun, p.search_star_line').text().replace(/\s+/g, ' ').trim();
        const salesRaw =
          $(el).find('.biaosheng').first().text().trim() ||
          star ||
          $(el)
            .find('span, a')
            .filter((j, s) => /条评论|人评|销量|已售/.test($(s).text()))
            .first()
            .text()
            .trim();
        books.push(
          makeBook({
            title,
            author: looksGarbled(author) ? '' : author,
            category: '人工智能',
            platform: '当当',
            rank: i + 1,
            sales: salesRaw || `榜单第${i + 1}名`,
            url: link.startsWith('http') ? link : link ? `http:${link}` : url
          })
        );
      });
      await sleep(500);
    } catch (err) {
      console.error('[books] dangdang fail:', err.message || err);
    }
  }
  return dedupePlatformList(books);
}

async function fetchJd() {
  const books = [];
  const cookie = platformCookie('jd');
  const headersBase = {
    Referer: 'https://search.jd.com/',
    ...(cookie ? { Cookie: cookie } : {})
  };

  for (const q of AI_QUERIES.slice(0, 6)) {
    try {
      // 不限 cat=1713（计算机），全站搜 AI 相关书
      const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(q + ' 图书')}&psort=3&enc=utf-8`;
      let html = await fetchHtml(url, 22000, headersBase);
      let parsed = parseJdHtml(html, q, url);
      if (!parsed.length) {
        const murl = `https://so.m.jd.com/products/search.action?keyword=${encodeURIComponent(q)}`;
        html = await fetchHtml(murl, 20000, {
          ...headersBase,
          'User-Agent': UA_MOBILE,
          Referer: 'https://so.m.jd.com/'
        });
        parsed = parseJdMobileHtml(html, q, murl);
      }
      if (!parsed.length) {
        console.warn(`[books] jd blocked/empty for ${q}${cookie ? '' : ' (可配置 JD_COOKIE)'}`);
      } else {
        books.push(...parsed);
      }
      await sleep(1200);
    } catch (err) {
      console.error('[books] jd fail:', err.message || err);
    }
  }
  return dedupePlatformList(books);
}

function parseJdHtml(html, q, url) {
  if (!html || /risk_handler|异常流量|验证/.test(html) || !/gl-item|J_goodsList|p-commit|data-sku/.test(html)) {
    return [];
  }
  const $ = cheerio.load(html);
  const books = [];
  $('#J_goodsList li.gl-item, li.gl-item').each((i, el) => {
    if (i >= 10) return;
    const title =
      $(el).find('.p-name em, .p-name a em').text().replace(/\s+/g, ' ').trim() ||
      $(el).find('.p-name a').attr('title') ||
      '';
    if (!title || looksGarbled(title)) return;
    if (!AI_TITLE_RE.test(title)) return;
    const link = $(el).find('.p-name a').attr('href') || '';
    const commit = $(el).find('.p-commit a, .p-commit strong').first().text().replace(/\s+/g, '').trim();
    books.push(
      makeBook({
        title,
        category: '人工智能',
        platform: '京东',
        rank: i + 1,
        sales: commit ? `${commit}人评价` : `搜索热度·第${i + 1}`,
        url: link.startsWith('http') ? link : link ? `https:${link}` : url
      })
    );
  });
  return books;
}

function parseJdMobileHtml(html, q, url) {
  if (!html || html.length < 800) return [];
  const books = [];
  const m =
    html.match(/wareList\s*[:=]\s*(\[[\s\S]*?\])\s*[,;]/) ||
    html.match(/"wareInfo"\s*:\s*(\[[\s\S]*?\])/);
  if (m) {
    try {
      const arr = JSON.parse(m[1]);
      (arr || []).slice(0, 10).forEach((it, i) => {
        const title = it.wname || it.wareName || it.title || '';
        const commit = it.commentCount || it.totalCount || '';
        if (!title) return;
        if (!AI_TITLE_RE.test(String(title))) return;
        books.push(
          makeBook({
            title: String(title).slice(0, 120),
            category: '人工智能',
            platform: '京东',
            rank: i + 1,
            sales: commit ? `${commit}人评价` : `移动搜索·第${i + 1}`,
            url: it.wareId ? `https://item.m.jd.com/product/${it.wareId}.html` : url
          })
        );
      });
    } catch (_e) {
      /* ignore */
    }
  }
  if (books.length) return books;
  const $ = cheerio.load(html);
  $('a').each((i, el) => {
    if (books.length >= 10) return;
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href') || '';
    if (title.length < 8 || title.length > 80) return;
    if (!/书|教材|深度|大模型|人工|机器|AI|ChatGPT|AIGC|智能/.test(title)) return;
    if (!AI_TITLE_RE.test(title)) return;
    if (!/item|product|sku/i.test(href)) return;
    books.push(
      makeBook({
        title,
        category: '人工智能',
        platform: '京东',
        rank: books.length + 1,
        sales: `移动搜索·第${books.length + 1}`,
        url: href.startsWith('http') ? href : `https:${href}`
      })
    );
  });
  return books;
}

async function fetchTaobao() {
  const books = [];
  const cookie = platformCookie('taobao');
  for (const q of ['大模型 书', '人工智能 书', 'ChatGPT 书', 'AIGC 图书', '具身智能 书', 'DeepSeek 书']) {
    try {
      const url = `https://s.taobao.com/search?q=${encodeURIComponent(q)}&sort=sale-desc`;
      const html = await fetchHtml(url, 22000, {
        Referer: 'https://www.taobao.com/',
        ...(cookie ? { Cookie: cookie } : {})
      });
      const jsonMatch =
        html.match(/g_page_config\s*=\s*(\{[\s\S]*?\});\s*/) ||
        html.match(/"auctions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/) ||
        html.match(/"itemsArray"\s*:\s*(\[[\s\S]*?\])/);
      let auctions = [];
      if (jsonMatch) {
        try {
          if (jsonMatch[0].includes('g_page_config')) {
            const cfg = JSON.parse(jsonMatch[1]);
            auctions =
              cfg?.mods?.itemlist?.data?.auctions ||
              cfg?.mainInfo?.data?.auctions ||
              [];
          } else {
            auctions = JSON.parse(jsonMatch[1]);
          }
        } catch (_e) {
          auctions = [];
        }
      }
      if (Array.isArray(auctions) && auctions.length) {
        auctions.slice(0, 12).forEach((it, i) => {
          const title = it.title || it.raw_title || it.wTitle || it.titleRaw || '';
          const sold = it.view_sales || it.realSales || it.sale || it.sellCount || it.procnt || '';
          const nid = it.nid || it.item_id || it.itemId || '';
          if (!title) return;
          const clean = String(title).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (!AI_TITLE_RE.test(clean)) return;
          books.push(
            makeBook({
              title: clean,
              category: '人工智能',
              platform: '淘宝',
              rank: i + 1,
              sales: sold ? String(sold) : `销量排序·第${i + 1}`,
              url: nid ? `https://item.taobao.com/item.htm?id=${nid}` : url
            })
          );
        });
      } else {
        console.warn(`[books] taobao empty/login wall for ${q}${cookie ? '' : ' (可配置 TAOBAO_COOKIE)'}`);
      }
      await sleep(1500);
    } catch (err) {
      console.error('[books] taobao fail:', err.message || err);
    }
  }
  return dedupePlatformList(books);
}

async function fetchDouyin() {
  const books = [];
  const cookie = platformCookie('douyin');
  for (const q of ['大模型书', '人工智能书', 'ChatGPT书', 'AIGC书籍', 'DeepSeek书', '具身智能书']) {
    try {
      const url = `https://www.douyin.com/search/${encodeURIComponent(q)}?type=general`;
      const html = await fetchHtml(url, 18000, {
        Referer: 'https://www.douyin.com/',
        'User-Agent': UA,
        ...(cookie ? { Cookie: cookie } : {})
      });

      let got = 0;
      if (html && html.length >= 2000 && !/验证码|captcha/i.test(html)) {
        const soldHits = html.match(/已售\s*([\d.万+]+)/g) || [];
        const titleHits =
          html.match(/"desc"\s*:\s*"([^"]{6,80})"/g) ||
          html.match(/"share_title"\s*:\s*"([^"]{6,80})"/g) ||
          [];
        titleHits.slice(0, 10).forEach((raw, i) => {
          const title = raw.replace(/^"[^"]+"\s*:\s*"/, '').replace(/"$/, '');
          if (!AI_TITLE_RE.test(title)) return;
          books.push(
            makeBook({
              title,
              category: '人工智能',
              platform: '抖音',
              rank: i + 1,
              sales: soldHits[i] || `抖音热度·第${i + 1}`,
              url
            })
          );
          got += 1;
        });
        const rd = html.match(/id="RENDER_DATA"[^>]*>([^<]+)</);
        if (rd && !got) {
          try {
            const decoded = decodeURIComponent(rd[1]);
            const titles = decoded.match(/"desc":"([^"]{6,80})"/g) || [];
            titles.slice(0, 8).forEach((raw, i) => {
              const title = raw.replace(/^"desc":"/, '').replace(/"$/, '');
              if (!AI_TITLE_RE.test(title)) return;
              books.push(
                makeBook({
                  title,
                  category: '人工智能',
                  platform: '抖音',
                  rank: i + 1,
                  sales: `抖音热度·第${i + 1}`,
                  url
                })
              );
              got += 1;
            });
          } catch (_e) {
            /* ignore */
          }
        }
      }

      if (!got) {
        try {
          const api =
            'https://www.douyin.com/aweme/v1/web/general/search/single/?device_platform=webapp&aid=6383&keyword=' +
            encodeURIComponent(q) +
            '&count=10&search_channel=aweme_general';
          const data = await fetchJson(api, 12000, {
            Referer: url,
            ...(cookie ? { Cookie: cookie } : {})
          });
          const list = data?.data || data?.aweme_list || [];
          (Array.isArray(list) ? list : []).slice(0, 8).forEach((row, i) => {
            const aweme = row.aweme_info || row;
            const title = aweme?.desc || aweme?.share_info?.share_title || '';
            if (!title || !AI_TITLE_RE.test(title)) return;
            books.push(
              makeBook({
                title: String(title).slice(0, 120),
                category: '人工智能',
                platform: '抖音',
                rank: i + 1,
                sales: `抖音热度·第${i + 1}`,
                url
              })
            );
            got += 1;
          });
        } catch (_e) {
          /* ignore */
        }
      }

      if (!got) {
        console.warn(`[books] douyin blocked for ${q}${cookie ? '' : ' (可配置 DOUYIN_COOKIE)'}`);
      }
      await sleep(1500);
    } catch (err) {
      console.error('[books] douyin fail:', err.message || err);
    }
  }
  return dedupePlatformList(books);
}

async function fetchBookschina() {
  const books = [];
  try {
    const html = await fetchHtml('https://www.bookschina.com/', 20000);
    const $ = cheerio.load(html);
    $('.mainText').each((i, el) => {
      if (books.length >= 30) return;
      const a = $(el).find('h2 a').first();
      const title = (a.attr('title') || a.text() || '').replace(/\s+/g, ' ').trim();
      if (!title || looksGarbled(title)) return;
      // 仅保留 AI 相关（不限计算机类目）
      if (!AI_TITLE_RE.test(title + $(el).text())) {
        return;
      }
      const salesRaw = $(el).find('.startWrap b, b').filter((j, s) => /条评论/.test($(s).text())).first().text().trim();
      const href = a.attr('href') || '';
      books.push(
        makeBook({
          title,
          category: '人工智能',
          platform: '中国图书网',
          rank: books.length + 1,
          sales: salesRaw || `站点热度·第${books.length + 1}`,
          url: href.startsWith('http') ? href : `https://www.bookschina.com${href}`
        })
      );
    });
  } catch (err) {
    console.error('[books] bookschina fail:', err.message || err);
  }
  return dedupePlatformList(books);
}

function dedupePlatformList(list) {
  const out = [];
  const seen = new Set();
  for (const b of list || []) {
    if (!b || !b.title || looksGarbled(b.title)) continue;
    const k = `${b.platform}|${titleKey(b.title)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

function mergeCrossPlatform(platformBooks) {
  /** @type {Map<string, any>} */
  const groups = new Map();

  function attach(book) {
    const key = titleKey(book.title);
    if (!key) return;
    let hitKey = key;
    if (!groups.has(key)) {
      let best = null;
      let bestScore = 0;
      for (const [k] of groups) {
        const score = similarity.compareTwoStrings(key, k);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      if (best && bestScore >= 0.72) hitKey = best;
      else {
        groups.set(key, {
          title: book.title,
          author: book.author || '',
          category: book.category || '人工智能',
          platforms: [],
          salesNum: 0,
          url: book.url || ''
        });
        hitKey = key;
      }
    }
    const g = groups.get(hitKey);
    if (book.title.length < g.title.length && book.title.length >= 4) g.title = book.title;
    if (!g.author && book.author) g.author = book.author;
    const existed = g.platforms.find((p) => p.platform === book.platform);
    const row = {
      platform: book.platform,
      sales: book.sales,
      salesNum: book.salesNum || 0,
      rank: book.rank || 0,
      url: book.url || ''
    };
    if (existed) {
      if (row.salesNum > existed.salesNum) Object.assign(existed, row);
    } else {
      g.platforms.push(row);
    }
    g.salesNum = g.platforms.reduce((s, p) => s + (p.salesNum || 0), 0);
    if (!g.url && book.url) g.url = book.url;
  }

  for (const list of Object.values(platformBooks)) {
    for (const b of list || []) attach(b);
  }

  const merged = Array.from(groups.values()).map((g) => {
    const parts = g.platforms
      .slice()
      .sort((a, b) => (b.salesNum || 0) - (a.salesNum || 0))
      .map((p) => `${p.platform}:${p.sales}`);
    const total = formatSalesNum(g.salesNum);
    return {
      title: g.title,
      author: g.author,
      category: g.category,
      platform: g.platforms.map((p) => p.platform).join('+'),
      platforms: g.platforms,
      platformCount: g.platforms.length,
      salesNum: g.salesNum,
      sales: total
        ? `全平台≈${total}人气 · ${parts.join(' / ')}`
        : parts.join(' / ') || '暂无销量字段',
      url: g.url
    };
  });

  merged.sort((a, b) => {
    if (b.platformCount !== a.platformCount) return b.platformCount - a.platformCount;
    return (b.salesNum || 0) - (a.salesNum || 0);
  });
  return merged;
}

function summarizeCategories(bestsellers) {
  const map = new Map();
  for (const b of bestsellers) {
    const cat = b.category || '未分类';
    if (!map.has(cat)) map.set(cat, { category: cat, count: 0, samples: [] });
    const row = map.get(cat);
    row.count += 1;
    if (row.samples.length < 3) row.samples.push(b.title);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function summarizePlatformCoverage(raw, merged) {
  const names = ['当当', '京东', '淘宝', '抖音', '中国图书网'];
  return names.map((name) => {
    const list = raw[name] || [];
    const inMerged = (merged || []).filter((b) => (b.platforms || []).some((p) => p.platform === name)).length;
    return {
      platform: name,
      crawled: list.length,
      merged: inMerged,
      ok: list.length > 0,
      note: list.length
        ? `采到 ${list.length} 条`
        : name === '当当'
          ? '采集失败'
          : name === '京东'
            ? '反爬中；可配 JD_COOKIE 提升成功率'
            : name === '淘宝'
              ? '登录墙；可配 TAOBAO_COOKIE'
              : name === '抖音'
                ? '风控较强；可配 DOUYIN_COOKIE'
                : '反爬/登录墙，暂无公开可解析数据'
    };
  });
}

function filterReadableBooks(list) {
  return (list || []).filter((b) => b && b.title && !looksGarbled(b.title));
}

function seedBestsellers() {
  return [
    {
      title: '深度学习',
      author: 'Ian Goodfellow 等',
      category: '人工智能基础',
      platform: '综合畅销',
      platforms: [{ platform: '综合', sales: '长期畅销', salesNum: 0 }],
      sales: '长期畅销',
      salesNum: 0,
      url: ''
    }
  ];
}

async function analyzeWithLlm(bestsellers, day) {
  if (!getApiKey()) {
    return {
      analysis: '未配置 DeepSeek API，暂无法生成市场分析。',
      planning: []
    };
  }
  const cats = summarizeCategories(bestsellers);
  const hotTitles = (day.hotspots || [])
    .slice(0, 15)
    .map((h) => h.title)
    .concat((day.items || []).slice(0, 10).map((n) => n.title));
  const bookLines = bestsellers
    .slice(0, 40)
    .map((b, i) => `${i + 1}. 《${b.title}》 ${b.author || ''} · ${b.category || ''}`)
    .join('\n');
  const prompt = `你是 AI / 人工智能图书策划编辑。下列是各渠道可见的「AI 相关」参考书目与品类汇总（可来自经管、教育、办公、科普等类目，不限于计算机/网络；仅作选题参考，不要讨论具体销量数字或平台覆盖）。
输出 JSON：
{
  "analysis": "200-400字，分析当前 AI 图书选题趋势、热门方向与原因",
  "planning": [
    {"title":"策划方向标题","angle":"切入角度","why":"为何适合现在做","audience":"目标读者"}
  ]
}
planning 给 3-5 条；只返回 JSON；不要 methodologies；不要写销量/评论数/平台覆盖；选题须与人工智能/大模型/AIGC 等相关。

参考书目：
${bookLines}

品类汇总：
${JSON.stringify(cats)}

当日热点：
${hotTitles.join('\n') || '（暂无）'}
`;
  try {
    const text = await chat(
      [
        { role: 'system', content: '你输出严格 JSON，中文，不要 markdown。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.5, maxTokens: 3500, timeoutMs: 120000 }
    );
    const parsed = extractJson(text);
    return {
      analysis: String(parsed.analysis || '').trim(),
      planning: Array.isArray(parsed.planning) ? parsed.planning : []
    };
  } catch (err) {
    console.error('[books] llm fail:', err.message || err);
    return {
      analysis: `分析生成失败：${err.message || err}`,
      planning: []
    };
  }
}

async function collectAllPlatforms() {
  // 日更一次：串行+间隔，降低京东/淘宝/抖音风控触发
  const runners = [
    ['当当', fetchDangdang],
    ['京东', fetchJd],
    ['淘宝', fetchTaobao],
    ['抖音', fetchDouyin],
    ['中国图书网', fetchBookschina]
  ];
  const raw = {};
  for (const [name, fn] of runners) {
    try {
      raw[name] = filterReadableBooks(await fn());
      console.log(`[books] ${name}: ${raw[name].length}`);
    } catch (err) {
      console.error(`[books] ${name} error:`, err.message || err);
      raw[name] = [];
    }
    await sleep(800);
  }
  return raw;
}

async function buildBooksInsight(dateKey, options = {}) {
  const key = dateKey || todayKey();
  const day = readDay(key);
  const forceCrawl = options.forceCrawl !== false;

  let bestsellers = [];
  let platformCoverage = [];
  let raw = {};

  if (forceCrawl) {
    raw = await collectAllPlatforms();
    bestsellers = mergeCrossPlatform(raw).filter((b) => AI_TITLE_RE.test(b.title));
    platformCoverage = summarizePlatformCoverage(raw, bestsellers);
    const crawledTotal = Object.values(raw).reduce((n, arr) => n + ((arr && arr.length) || 0), 0);
    // 全挂时不要把旧缓存静默顶成“今日全平台”
    if (!crawledTotal) {
      console.warn('[books] all platforms empty this run');
    }
  }

  if (!bestsellers.length) {
    const latest = findLatestBooks();
    const cached = latest ? filterReadableBooks(latest.books.bestsellers || []) : [];
    if (cached.length) {
      // 旧缓存若无 platforms 字段，包一层便于前端展示
      bestsellers = cached.map((b) => {
        if (Array.isArray(b.platforms) && b.platforms.length) return b;
        return {
          ...b,
          platforms: b.platform
            ? [{ platform: String(b.platform).split('+')[0], sales: b.sales || '', salesNum: b.salesNum || 0, url: b.url || '' }]
            : [],
          platformCount: 1
        };
      });
      platformCoverage = latest.books.platformCoverage || platformCoverage;
      console.log(`[books] using cached bestsellers from ${latest.date}`);
    } else {
      bestsellers = seedBestsellers();
      platformCoverage = summarizePlatformCoverage({}, bestsellers);
      console.log('[books] using seed bestsellers');
    }
  }

  const llm = await analyzeWithLlm(bestsellers, day);
  const books = {
    bestsellers: bestsellers.slice(0, 50),
    categories: summarizeCategories(bestsellers),
    analysis: llm.analysis,
    planning: llm.planning,
    note: '每周一更新：聚焦 AI 相关图书（不限计算机/网络类目），含品类观察、市场分析与策划方向。',
    updatedAt: new Date().toISOString()
  };
  saveBooks(key, books);
  return books;
}

const TOPIC_EDITOR_SYSTEM =
  '你是资深科技类出版编辑，擅长人工智能、互联网、前沿科技图书选题策划。' +
  '你的能力覆盖：选题思路（背景与现状研判）、差异化角度提炼、读者对象分析、图书结构设计、市场分析（盘点现有相关书籍并指出空白）、本书卖点分析。' +
  '只从出版可行性、读者价值、市场差异化出发给出方案，内容具体可执行，不要空话套话。' +
  '你输出严格 JSON，中文，不要 markdown。';

/**
 * 根据用户输入生成选题策划方案（每次请求均带固定编辑身份）
 */
async function generateTopicPlan(userInput) {
  const input = String(userInput || '').trim().slice(0, 2000);
  if (!input) {
    const err = new Error('请输入选题线索');
    err.status = 400;
    throw err;
  }
  if (!getApiKey()) {
    const err = new Error('未配置 DeepSeek API，无法生成选题方案');
    err.status = 503;
    throw err;
  }

  const prompt = `请根据下列用户提供的选题线索，撰写一份图书选题策划方案。
必须严格按下列字段顺序输出 JSON（不要增删字段名）：
{
  "title": "选题方案标题",
  "topicIdea": "选题思路：合并写清背景与现状",
  "angle": "角度：本书差异化切入点",
  "audience": "读者对象分析：核心读者与使用场景",
  "structure": "结构：章节或模块安排（可用分点/换行）",
  "marketAnalysis": "市场分析：现有相关书籍盘点（不少于3本，注明与本选题差异/空白）",
  "sellingPoints": "本书卖点分析：3-6条可感知卖点"
}
要求：各段具体可执行；不要讨论销量数字；marketAnalysis 须含真实或常见的科技类相关书目。

用户线索：
${input}
`;

  const text = await chat(
    [
      { role: 'system', content: TOPIC_EDITOR_SYSTEM },
      { role: 'user', content: prompt }
    ],
    { temperature: 0.5, maxTokens: 3500, timeoutMs: 120000 }
  );
  const parsed = extractJson(text) || {};
  const topicIdea = String(
    parsed.topicIdea || parsed.topic_idea ||
      [parsed.background, parsed.status].filter(Boolean).join('\n') ||
      ''
  ).trim();
  const marketAnalysis = String(
    parsed.marketAnalysis ||
      parsed.market_analysis ||
      parsed.relatedBooks ||
      parsed.related_books ||
      ''
  ).trim();
  const sellingPoints = String(
    parsed.sellingPoints || parsed.selling_points || parsed.sellingPoint || ''
  ).trim();

  return {
    title: String(parsed.title || '').trim() || '选题策划方案',
    topicIdea,
    angle: String(parsed.angle || '').trim(),
    audience: String(parsed.audience || '').trim(),
    structure: String(parsed.structure || '').trim(),
    marketAnalysis,
    sellingPoints
  };
}

module.exports = {
  buildBooksInsight,
  generateTopicPlan,
  fetchDangdang,
  fetchJd,
  fetchTaobao,
  fetchDouyin,
  fetchBookschina,
  mergeCrossPlatform
};
