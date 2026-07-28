const cloudscraper = require('cloudscraper');
const fs = require('fs');
const auth = JSON.parse(fs.readFileSync('/var/www/technews/data/wechat-auth.json', 'utf8'));
const PLATFORM = 'https://weread.111965.xyz';

function bizToMpId(biz) {
  const buf = Buffer.from(String(biz).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const digits = buf.toString('utf8').replace(/[^\d]/g, '');
  return digits ? 'MP_WXS_' + digits : '';
}

function addKH(url) {
  const full = url.startsWith('http') ? url : 'https://weixin.sogou.com' + url;
  if (full.includes('&k=')) return full;
  const a = full.indexOf('url=');
  const b = Math.floor(Math.random() * 100) + 1;
  const h = full.charAt(a + 30 + b) || '0';
  return full + '&k=' + b + '&h=' + h;
}

function assemble(body) {
  const parts = [...String(body).matchAll(/url\s*\+=\s*'([^']*)';/g)].map((m) => m[1]);
  if (parts.length) return parts.join('').replace(/@/g, '');
  return '';
}

function namesMatch(a, b) {
  const x = String(a || '').replace(/\s+/g, '');
  const y = String(b || '').replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

async function wxs2mp(url) {
  const res = await fetch(PLATFORM + '/api/v2/platform/wxs2mp', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      xid: String(auth.vid),
      Authorization: 'Bearer ' + auth.token
    },
    body: JSON.stringify({ url })
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data: Array.isArray(data) ? data[0] : null };
}

async function articles(mpId) {
  const res = await fetch(
    PLATFORM + '/api/v2/platform/mps/' + encodeURIComponent(mpId) + '/articles?page=1',
    {
      headers: {
        xid: String(auth.vid),
        Authorization: 'Bearer ' + auth.token
      }
    }
  );
  const data = await res.json().catch(() => null);
  return {
    n: Array.isArray(data) ? data.length : -1,
    title: Array.isArray(data) && data[0] ? data[0].title : ''
  };
}

function parseSogouBoxes(html, name) {
  // sogou uses <ul class="news-list"> <li> ...
  const items = [];
  const liRe = /<li\b[\s\S]*?<\/li>/gi;
  let m;
  while ((m = liRe.exec(html))) {
    const block = m[0];
    if (!/\/link\?url=/.test(block)) continue;
    const href = (block.match(/href="(\/link\?url=[^"]+)"/) || [])[1];
    if (!href) continue;
    // account often: <a class="account" ...>NAME</a> or data in tip
    let account =
      (block.match(/class="account"[^>]*>([\s\S]*?)<\/a>/i) || [])[1] ||
      (block.match(/data-sourcename="([^"]+)"/i) || [])[1] ||
      (block.match(/作者[：:]\s*<[^>]+>([\s\S]*?)</) || [])[1] ||
      '';
    account = account.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    // sometimes account is plain text after 来源
    if (!account) {
      const tip = (block.match(/class="s-p"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
      const am = tip.match(/account[^>]*>([\s\S]*?)</i) || tip.match(/>([^<]{2,30})<\/a>\s*<span/);
      if (am) account = am[1].replace(/<[^>]+>/g, '').trim();
    }
    const title = (
      (block.match(/uigs="article_title_\d+"[\s\S]*?>([\s\S]*?)<\/a>/i) || [])[1] ||
      ''
    )
      .replace(/<[^>]+>/g, '')
      .trim();
    items.push({
      href: href.replace(/&amp;/g, '&'),
      account,
      title,
      match: namesMatch(account, name)
    });
  }
  return items;
}

async function openArticleFromSogou(href, referer) {
  const jump = await cloudscraper.get({
    uri: addKH(href),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: referer
    },
    followAllRedirects: true
  });
  let share = assemble(jump);
  if (!share) return null;
  const page = await cloudscraper.get({
    uri: share,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    followAllRedirects: true
  });
  const html = String(page);
  const biz = (html.match(/var\s+biz\s*=\s*(?:""\|\|)?\s*"([A-Za-z0-9+/=]+)"/) ||
    html.match(/var\s+biz\s*=\s*"([A-Za-z0-9+/=]+)"/) ||
    html.match(/[?&]__biz=([A-Za-z0-9+/=]+)/) || [])[1];
  const mid = (html.match(/var\s+mid\s*=\s*(?:""\|\|)?\s*"(\d+)"/) ||
    html.match(/var\s+mid\s*=\s*"(\d+)"/) || [])[1];
  const sn = (html.match(/var\s+sn\s*=\s*(?:""\|\|)?\s*"([a-f0-9]+)"/) ||
    html.match(/var\s+sn\s*=\s*"([a-f0-9]+)"/) || [])[1];
  const idx = (html.match(/var\s+idx\s*=\s*(?:""\|\|)?\s*"(\d+)"/) ||
    html.match(/var\s+idx\s*=\s*"(\d+)"/) || [])[1] || '1';
  const nick = (
    (html.match(/var\s+nickname\s*=\s*(?:htmlDecode\()?\"([^\"]+)\"/) ||
      html.match(/id=\"js_name\"[^>]*>([\s\S]*?)</) ||
      html.match(/property=\"og:article:author\"\s+content=\"([^\"]+)\"/) ||
      [])[1] || ''
  )
    .replace(/<[^>]+>/g, '')
    .trim();
  let canonical = '';
  if (biz && mid && sn) {
    canonical = `https://mp.weixin.qq.com/s?__biz=${biz}&mid=${mid}&idx=${idx}&sn=${sn}`;
  }
  // real msg_link often has #rd
  const msgLink = (html.match(/msg_link\s*=\s*\"(https?:\/\/mp\.weixin\.qq\.com\/s\?[^\"]+)\"/) ||
    [])[1];
  if (msgLink) canonical = msgLink.replace(/&amp;/g, '&').split('#')[0];
  return { biz, mid, sn, nick, canonical, mpId: biz ? bizToMpId(biz) : '' };
}

async function resolveAccount(name) {
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' +
    encodeURIComponent('"' + name + '"') +
    '&ie=utf8';
  const html = await cloudscraper.get({
    uri: searchUrl,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  fs.writeFileSync('/tmp/sogou_' + name + '.html', String(html).slice(0, 80000));
  let items = parseSogouBoxes(html, name);
  if (!items.length) {
    // fallback without quotes
    const html2 = await cloudscraper.get({
      uri:
        'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    items = parseSogouBoxes(html2, name);
  }
  console.log(
    name,
    'items',
    items.slice(0, 6).map((x) => ({ a: x.account, m: x.match, t: (x.title || '').slice(0, 16) }))
  );
  const ordered = [...items.filter((x) => x.match), ...items.filter((x) => !x.match)];
  for (const it of ordered.slice(0, 8)) {
    try {
      const art = await openArticleFromSogou(it.href, searchUrl);
      if (!art) continue;
      console.log('art', {
        nick: art.nick,
        biz: art.biz,
        mpId: art.mpId,
        hasCanon: !!art.canonical
      });
      if (art.nick && !namesMatch(art.nick, name) && it.account && !namesMatch(it.account, name)) {
        continue;
      }
      // Prefer wxs2mp with canonical URL to initialize
      if (art.canonical) {
        const w = await wxs2mp(art.canonical);
        if (w.data && namesMatch(w.data.name, name)) {
          return { mpId: w.data.id, name: w.data.name, cover: w.data.cover, via: 'wxs' };
        }
        if (w.data && (namesMatch(art.nick, name) || namesMatch(it.account, name))) {
          // name from page matched even if wxs name slightly off
          if (namesMatch(w.data.name, name) || namesMatch(art.nick, name)) {
            return { mpId: w.data.id, name: w.data.name, cover: w.data.cover, via: 'wxs-nick' };
          }
        }
      }
      if (art.mpId && (namesMatch(art.nick, name) || namesMatch(it.account, name))) {
        // initialize via constructed URL if possible
        if (art.canonical) await wxs2mp(art.canonical).catch(() => null);
        const ar = await articles(art.mpId);
        if (ar.n > 0) {
          return { mpId: art.mpId, name, via: 'biz', sample: ar.title };
        }
        // still save mpId even if empty for now
        return { mpId: art.mpId, name, via: 'biz-empty', sample: ar.title };
      }
    } catch (e) {
      console.log('item fail', e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

(async () => {
  // verify 新智元 known
  console.log('seed 新智元', await articles('MP_WXS_3271041950'));
  for (const name of ['新智元', '量子位', '机器之心']) {
    const r = await resolveAccount(name);
    console.log('RESULT', name, r);
    await new Promise((x) => setTimeout(x, 1000));
  }
})();
