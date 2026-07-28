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
  const rep = String(body).match(
    /window\.location\.replace\(\s*(['"])(https?:\/\/mp\.weixin\.qq\.com[^'"]+)\1\s*\)/
  );
  if (rep) return rep[2];
  const m = String(body).match(/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+/);
  if (m) return m[0];
  const m2 = String(body).match(/https?:\/\/mp\.weixin\.qq\.com\/s\?[^"'\s<>]+/);
  return m2 ? m2[0] : '';
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
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_e) {}
  return { status: res.status, data, text: text.slice(0, 300) };
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
    status: res.status,
    n: Array.isArray(data) ? data.length : -1,
    title: Array.isArray(data) && data[0] ? data[0].title : ''
  };
}

async function resolveViaSogou(name) {
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8';
  const html = await cloudscraper.get({
    uri: searchUrl,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const links = [...String(html).matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  );
  const uniq = [...new Set(links)].slice(0, 5);
  for (const rel of uniq) {
    const link = addKH(rel);
    const body = await cloudscraper.get({
      uri: link,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: searchUrl
      },
      followAllRedirects: true
    });
    fs.writeFileSync('/tmp/sogou_body.html', String(body).slice(0, 5000));
    let share = assemble(body);
    // sogou sometimes returns intermediate src=11 URL; try open it to get redirect/canonical
    if (share && /[?&]src=11/.test(share)) {
      try {
        const page = await cloudscraper.get({
          uri: share,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          followAllRedirects: true
        });
        const biz = String(page).match(/var biz\s*=\s*\"([^\"]+)\"|__biz=([A-Za-z0-9+/=]+)/);
        const sn = String(page).match(/var sn\s*=\s*\"([^\"]+)\"/);
        const mid = String(page).match(/var mid\s*=\s*\"([^\"]+)\"/);
        console.log('page biz', biz && (biz[1] || biz[2]), 'sn', sn && sn[1], 'mid', mid && mid[1]);
        if (biz) {
          const b = biz[1] || biz[2];
          if (sn && mid) {
            share = `https://mp.weixin.qq.com/s?__biz=${b}&mid=${mid[1]}&idx=1&sn=${sn[1]}`;
          } else {
            // still try short link extraction
            const short = String(page).match(/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]+)/);
            if (short) share = 'https://mp.weixin.qq.com/s/' + short[1];
          }
        }
      } catch (e) {
        console.log('open share fail', e.message);
      }
    }
    console.log('candidate', share.slice(0, 160));
    if (!share) continue;
    const w = await wxs2mp(share.split('#')[0]);
    console.log('wxs', w.status, w.text);
    if (w.status === 200 && Array.isArray(w.data) && w.data[0]) {
      return w.data[0];
    }
    const bm = share.match(/[?&]__biz=([^&]+)/);
    if (bm) {
      const mpId = bizToMpId(decodeURIComponent(bm[1]));
      const ar = await articles(mpId);
      console.log('biz path', mpId, ar);
      if (ar.n > 0) return { id: mpId, name, cover: '' };
    }
  }
  return null;
}

(async () => {
  // known short links from aiera
  for (const u of [
    'https://mp.weixin.qq.com/s/YgiurOE0uZ7lRDx1ehpbhQ',
    'https://mp.weixin.qq.com/s/93z4Ta91yLv7PB1pnBM9mg'
  ]) {
    const w = await wxs2mp(u);
    console.log('aiera', u, w.status, w.text);
    if (w.data && w.data[0]) {
      const ar = await articles(w.data[0].id);
      console.log('articles', w.data[0].name, ar);
    }
  }

  const info = await resolveViaSogou('量子位');
  console.log('resolved', info);
})();
