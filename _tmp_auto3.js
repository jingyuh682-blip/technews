const cloudscraper = require('cloudscraper');
const fs = require('fs');
const auth = JSON.parse(fs.readFileSync('/var/www/technews/data/wechat-auth.json', 'utf8'));
const PLATFORM = 'https://weread.111965.xyz';

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
  const m = String(body).match(/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]{6,}/);
  return m ? m[0] : '';
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
  return { status: res.status, data };
}

async function resolveAccount(name) {
  // Prefer exact account search query: name + 公众号
  const q = name;
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(q) + '&ie=utf8';
  const html = await cloudscraper.get({
    uri: searchUrl,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  // each news-box
  const boxes = String(html).split(/class="news-box"|class="txt-box"/).slice(1);
  const candidates = [];
  for (const box of boxes.slice(0, 15)) {
    const account = (box.match(/class="account"[^>]*>([\s\S]*?)<\//) || [])[1] || '';
    const accountText = account.replace(/<[^>]+>/g, '').trim();
    const href = (box.match(/href="(\/link\?url=[^"]+)"/) || [])[1];
    const title = (box.match(/uigs="article_title_\d+"[^>]*>([\s\S]*?)<\//) ||
      box.match(/target="_blank"[^>]*>([\s\S]*?)<\//) || [])[1];
    const titleText = (title || '').replace(/<[^>]+>/g, '').trim();
    if (!href) continue;
    candidates.push({
      account: accountText,
      title: titleText,
      href: href.replace(/&amp;/g, '&'),
      match: accountText === name || accountText.indexOf(name) >= 0 || name.indexOf(accountText) >= 0
    });
  }
  console.log(
    name,
    'candidates',
    candidates.slice(0, 8).map((c) => ({ a: c.account, m: c.match, t: c.title.slice(0, 20) }))
  );
  const ordered = candidates.filter((c) => c.match).concat(candidates.filter((c) => !c.match));
  for (const c of ordered.slice(0, 6)) {
    try {
      const body = await cloudscraper.get({
        uri: addKH(c.href),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: searchUrl
        },
        followAllRedirects: true
      });
      let share = assemble(body);
      if (share && /[?&]src=11/.test(share)) {
        const page = await cloudscraper.get({
          uri: share,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          followAllRedirects: true
        });
        const short = String(page).match(/msg_link\s*=\s*\"(https?:\/\/mp\.weixin\.qq\.com\/s\?[^\"&]+)/);
        const short2 = String(page).match(/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]{10,}/);
        const biz = String(page).match(/var biz\s*=\s*\"?\s*||\s*\"([^\"]+)\"/) ||
          String(page).match(/var biz\s*=\s*\"([^\"]+)\"/);
        // better biz extract
        const biz2 = String(page).match(/var biz\s*=\s*\"([^\"]+)\"/);
        const mid = String(page).match(/var mid\s*=\s*\"([^\"]+)\"/);
        const sn = String(page).match(/var sn\s*=\s*\"([^\"]+)\"/);
        const idx = String(page).match(/var idx\s*=\s*\"([^\"]+)\"/);
        if (biz2 && mid && sn) {
          share = `https://mp.weixin.qq.com/s?__biz=${biz2[1]}&mid=${mid[1]}&idx=${(idx && idx[1]) || 1}&sn=${sn[1]}`;
        } else if (short2) {
          share = short2[0];
        }
        console.log('parsed', { biz: biz2 && biz2[1], mid: mid && mid[1], sn: sn && sn[1], share: share && share.slice(0, 100) });
      }
      if (!share) continue;
      // Prefer short /s/xxx form for wxs2mp
      let tryUrl = share;
      if (!/\/s\/[A-Za-z0-9_-]+$/.test(share.split('?')[0]) && /__biz=/.test(share)) {
        // still try
      }
      const w = await wxs2mp(tryUrl.split('#')[0]);
      const item = Array.isArray(w.data) ? w.data[0] : null;
      console.log('wxs', c.account, item && item.name, item && item.id, w.status);
      if (item && (item.name === name || item.name.indexOf(name) >= 0 || name.indexOf(item.name) >= 0)) {
        return item;
      }
      if (item && c.match) {
        // account matched in sogou list; accept even if slight name diff
        return item;
      }
    } catch (e) {
      console.log('cand fail', e.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

(async () => {
  for (const name of ['量子位', '机器之心', '新智元', 'CVer', 'Datawhale']) {
    try {
      const info = await resolveAccount(name);
      console.log('OK', name, info && info.id, info && info.name);
    } catch (e) {
      console.log('FAIL', name, e.message);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
})();
