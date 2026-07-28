/**
 * 自动解析微信公众号 -> 微信读书 mpId
 * 优先级：种子 → 微信读书搜索 → 搜狗（按账号名匹配）→ 镜像短链
 */
const cloudscraper = require('cloudscraper');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 已验证可用的核心号 mpId */
const SEED_MP_IDS = {
  新智元: 'MP_WXS_3271041950',
  量子位: 'MP_WXS_3236757533',
  机器之心: 'MP_WXS_3073282833',
  AI科技大本营: 'MP_WXS_3884405249',
  Datawhale: 'MP_WXS_3226363426',
  视学算法: 'MP_WXS_3586218329'
};

const MIRROR_SITES = ['https://www.aiera.com.cn/'];

function namesMatch(a, b) {
  const x = String(a || '')
    .replace(/\s+/g, '')
    .toLowerCase();
  const y = String(b || '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function bizToMpId(biz) {
  try {
    const raw = Buffer.from(String(biz).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const digits = raw.toString('utf8').replace(/[^\d]/g, '');
    return digits ? `MP_WXS_${digits}` : '';
  } catch (_e) {
    return '';
  }
}

function addSogouKH(url) {
  const full = url.startsWith('http') ? url : `https://weixin.sogou.com${url}`;
  if (full.includes('&k=')) return full;
  const a = full.indexOf('url=');
  if (a < 0) return full;
  const b = Math.floor(Math.random() * 100) + 1;
  const h = full.charAt(a + 30 + b) || '0';
  return `${full}&k=${b}&h=${encodeURIComponent(h)}`;
}

function assembleSogouJumpUrl(body) {
  const parts = [...String(body).matchAll(/url\s*\+=\s*'([^']*)';/g)].map((m) => m[1]);
  if (!parts.length) return '';
  return parts.join('').replace(/@/g, '');
}

async function httpGet(url, { referer, timeoutMs = 25000 } = {}) {
  return cloudscraper.get({
    uri: url,
    timeout: timeoutMs,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...(referer ? { Referer: referer } : {})
    },
    followAllRedirects: true
  });
}

function extractArticleMeta(html) {
  const h = String(html || '');
  const biz =
    (h.match(/var\s+biz\s*=\s*""\s*\|\|\s*"([A-Za-z0-9+/=]+)"/) ||
      h.match(/var\s+biz\s*=\s*"([A-Za-z0-9+/=]+)"/) ||
      h.match(/[?&]__biz=([A-Za-z0-9+/=]+)/) ||
      [])[1] || '';
  const nick = (
    (h.match(/id="js_name"[^>]*>([\s\S]*?)</) ||
      h.match(/nick_name:\s*'([^']+)'/) ||
      h.match(/nickname=\\x22([^\\]+)\\x22/) ||
      h.match(/property="og:article:author"\s+content="([^"]+)"/) ||
      [])[1] || ''
  )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  const short =
    (h.match(/https?:\/\/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]{10,})/) || [])[0] || '';
  let canonical = '';
  const mid = (h.match(/var\s+mid\s*=\s*(?:""\s*\|\|\s*)?"(\d+)"/) || [])[1];
  const sn = (h.match(/var\s+sn\s*=\s*(?:""\s*\|\|\s*)?"([a-f0-9]+)"/) || [])[1];
  const idx = (h.match(/var\s+idx\s*=\s*(?:""\s*\|\|\s*)?"(\d+)"/) || [])[1] || '1';
  if (biz && mid && sn) {
    canonical = `https://mp.weixin.qq.com/s?__biz=${biz}&mid=${mid}&idx=${idx}&sn=${sn}`;
  }
  const msgLink = (h.match(/msg_link\s*=\s*"(https?:\/\/mp\.weixin\.qq\.com\/s\?[^"]+)"/) || [])[1];
  if (msgLink) canonical = msgLink.replace(/&amp;/g, '&').split('#')[0];
  return {
    biz,
    nick,
    short: short || canonical,
    shareUrl: short || canonical,
    mpId: biz ? bizToMpId(biz) : ''
  };
}

/** 从搜狗文章列表里解析「账号名 + 链接」，优先点同名公众号的文章 */
function parseSogouArticleBoxes(html, name) {
  const items = [];
  const liRe = /<li\b[\s\S]*?<\/li>/gi;
  let m;
  while ((m = liRe.exec(String(html || '')))) {
    const block = m[0];
    if (!/\/link\?url=/.test(block)) continue;
    const href = ((block.match(/href="(\/link\?url=[^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
    if (!href) continue;
    let account =
      (block.match(/class="account"[^>]*>([\s\S]*?)<\/a>/i) || [])[1] ||
      (block.match(/data-sourcename="([^"]+)"/i) || [])[1] ||
      '';
    account = account.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    items.push({ href, account, match: namesMatch(account, name) });
  }
  items.sort((a, b) => Number(b.match) - Number(a.match));
  return items;
}

async function openSogouArticle(href, referer) {
  const jump = await httpGet(addSogouKH(href), { referer });
  const share = assembleSogouJumpUrl(jump);
  if (!share) return null;
  const page = await httpGet(share, { referer });
  return extractArticleMeta(page);
}

async function resolveViaSogou(name, { maxTries = 6 } = {}) {
  // type=2 搜文章，按列表里的账号名过滤
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8';
  let html = '';
  try {
    html = await httpGet(searchUrl);
  } catch (err) {
    console.warn(`[auto-resolve] sogou search ${name}:`, err.message || err);
    return null;
  }

  const boxes = parseSogouArticleBoxes(html, name);
  const prefer = boxes.filter((x) => x.match).slice(0, maxTries);
  const fallback = boxes.filter((x) => !x.match).slice(0, 2);
  const queue = prefer.length ? prefer : fallback;

  for (const item of queue) {
    try {
      const meta = await openSogouArticle(item.href, searchUrl);
      if (!meta || !meta.mpId) continue;
      if (meta.nick && !namesMatch(meta.nick, name) && prefer.length) continue;
      if (meta.nick && !namesMatch(meta.nick, name) && !prefer.length) continue;
      return {
        mpId: meta.mpId,
        name: meta.nick || name,
        biz: meta.biz,
        shareUrl: meta.shareUrl || meta.short || '',
        via: 'sogou-biz'
      };
    } catch (err) {
      console.warn(`[auto-resolve] sogou item ${name}:`, err.message || err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // type=1 搜公众号主页，打开其最新文章
  try {
    const accUrl =
      'https://weixin.sogou.com/weixin?type=1&query=' + encodeURIComponent(name) + '&ie=utf8';
    const accHtml = await httpGet(accUrl);
    const hrefs = [
      ...new Set(
        [...String(accHtml).matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) =>
          m[1].replace(/&amp;/g, '&')
        )
      )
    ].slice(0, 3);
    for (const href of hrefs) {
      try {
        const meta = await openSogouArticle(href, accUrl);
        if (!meta || !meta.mpId) continue;
        if (meta.nick && !namesMatch(meta.nick, name)) continue;
        return {
          mpId: meta.mpId,
          name: meta.nick || name,
          biz: meta.biz,
          shareUrl: meta.shareUrl || meta.short || '',
          via: 'sogou-account'
        };
      } catch (_e) {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (err) {
    console.warn(`[auto-resolve] sogou account ${name}:`, err.message || err);
  }

  return null;
}

async function harvestMirrorShortLinks() {
  const links = new Set();
  for (const site of MIRROR_SITES) {
    try {
      const html = await httpGet(site);
      for (const m of String(html).matchAll(/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]{6,}/g)) {
        links.add(m[0]);
      }
    } catch (err) {
      console.warn('[auto-resolve] mirror', site, err.message || err);
    }
  }
  return [...links];
}

/**
 * @param {object} auth
 * @param {string} name
 * @param {{ searchMp?: Function, wxs2mp?: Function, probeArticles?: Function }} helpers
 */
async function resolveOneAccount(auth, name, helpers = {}) {
  if (SEED_MP_IDS[name]) {
    return { mpId: SEED_MP_IDS[name], name, via: 'seed' };
  }

  // 1) 微信读书平台搜索（最快）
  if (helpers.searchMp) {
    try {
      const hit = await helpers.searchMp(auth, name);
      if (hit && hit.mpId) {
        return { mpId: hit.mpId, name: hit.name || name, via: 'weread-search' };
      }
    } catch (err) {
      if (err && err.code === 'AUTH_EXPIRED') throw err;
      console.warn(`[auto-resolve] searchMp ${name}:`, err.message || err);
    }
  }

  // 2) 搜狗提取 __biz
  const sogou = await resolveViaSogou(name);
  if (sogou && sogou.mpId) {
    if (sogou.shareUrl && helpers.wxs2mp) {
      try {
        await helpers.wxs2mp(auth, sogou.shareUrl);
      } catch (_e) {
        /* wxs2mp 失败仍可用 biz 推导的 mpId */
      }
    }
    if (helpers.probeArticles) {
      try {
        const n = await helpers.probeArticles(auth, sogou.mpId);
        if (n > 0) return sogou;
      } catch (_e) {
        /* 探测失败也先收下，后续拉文再试 */
      }
    }
    return sogou;
  }

  return null;
}

/**
 * 批量自动匹配核心号（不截断，逐个匹配全部未绑定号）
 * helpers: { searchMp, wxs2mp, probeArticles, onProgress, onMatched }
 */
async function autoResolveAccounts(auth, accounts, helpers = {}) {
  const list = accounts || [];
  const results = [];
  const pending = list.filter((a) => a && a.name && !a.mpId);
  const total = Math.max(1, pending.length);

  // 先吃镜像站短链，按返回名匹配
  if (helpers.wxs2mp) {
    try {
      helpers.onProgress && helpers.onProgress('扫描镜像站分享链…', 5);
      const shorts = await harvestMirrorShortLinks();
      for (let i = 0; i < shorts.length; i++) {
        try {
          const info = await helpers.wxs2mp(auth, shorts[i]);
          if (!info || !info.mpId) continue;
          const hit = pending.find((a) => !a.mpId && namesMatch(a.name, info.name));
          if (hit) {
            hit.mpId = info.mpId;
            hit.shareUrl = shorts[i];
            results.push({ name: hit.name, mpId: info.mpId, via: 'mirror' });
            helpers.onMatched && helpers.onMatched(hit);
          }
        } catch (_e) {
          /* ignore single */
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (err) {
      console.warn('[auto-resolve] mirror harvest:', err.message || err);
    }
  }

  for (let i = 0; i < pending.length; i++) {
    const a = pending[i];
    if (a.mpId) continue;
    const pct = 8 + Math.floor((i / total) * 55);
    helpers.onProgress &&
      helpers.onProgress(`自动匹配 ${a.name}（${i + 1}/${pending.length}）…`, pct);
    try {
      const info = await resolveOneAccount(auth, a.name, helpers);
      if (info && info.mpId) {
        a.mpId = info.mpId;
        if (info.shareUrl) a.shareUrl = info.shareUrl;
        if (info.biz) a.biz = info.biz;
        results.push({ name: a.name, mpId: info.mpId, via: info.via || 'auto' });
        helpers.onMatched && helpers.onMatched(a);
      } else {
        results.push({ name: a.name, error: 'unresolved' });
      }
    } catch (err) {
      if (err && err.code === 'AUTH_EXPIRED') throw err;
      console.warn(`[auto-resolve] ${a.name}:`, err.message || err);
      results.push({ name: a.name, error: err.message || String(err) });
    }
    await new Promise((r) => setTimeout(r, 550));
  }

  return { accounts: list, results };
}

module.exports = {
  SEED_MP_IDS,
  MIRROR_SITES,
  namesMatch,
  bizToMpId,
  resolveViaSogou,
  harvestMirrorShortLinks,
  resolveOneAccount,
  autoResolveAccounts
};
