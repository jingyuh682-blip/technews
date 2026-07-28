const cloudscraper = require('cloudscraper');
const fs = require('fs');
const auth = JSON.parse(fs.readFileSync('/var/www/technews/data/wechat-auth.json', 'utf8'));
const PLATFORM = 'https://weread.111965.xyz';

function addKH(url) {
  const full = url.startsWith('http') ? url : 'https://weixin.sogou.com' + url;
  if (full.includes('&k=')) return full;
  const a = full.indexOf('url=');
  const b = Math.floor(Math.random() * 100) + 1;
  return full + '&k=' + b + '&h=' + (full.charAt(a + 30 + b) || '0');
}
function assemble(body) {
  const parts = [...String(body).matchAll(/url\s*\+=\s*'([^']*)';/g)].map((m) => m[1]);
  return parts.length ? parts.join('').replace(/@/g, '') : '';
}

(async () => {
  const name = '量子位';
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8';
  const html = await cloudscraper.get({ uri: searchUrl });
  // find a li that will lead to 量子位 - try several
  const hrefs = [...String(html).matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  );
  for (const href of [...new Set(hrefs)].slice(0, 12)) {
    const jump = await cloudscraper.get({
      uri: addKH(href),
      headers: { Referer: searchUrl },
      followAllRedirects: true
    });
    const share = assemble(jump);
    if (!share) continue;
    const page = await cloudscraper.get({ uri: share, followAllRedirects: true });
    const h = String(page);
    const nick = (h.match(/id=\"js_name\"[^>]*>([\s\S]*?)</) || [])[1] || '';
    if (!nick.includes('量子位')) continue;
    fs.writeFileSync('/tmp/qbit_page.html', h.slice(0, 20000));
    // dump relevant vars
    for (const key of ['biz', 'mid', 'sn', 'idx', 'msg_link', 'msg_title', 'nickname', 'user_name']) {
      const re = new RegExp(key + '[\\s\\S]{0,80}', 'i');
      const m = h.match(re);
      console.log(key, m && m[0].replace(/\s+/g, ' ').slice(0, 100));
    }
    const og = h.match(/property=\"og:url\"\s+content=\"([^\"]+)\"/);
    console.log('og', og && og[1]);
    const canonical = h.match(/rel=\"canonical\"\s+href=\"([^\"]+)\"/);
    console.log('canonical', canonical && canonical[1]);
    // try all possible share forms with wxs2mp
    const biz = (h.match(/var\s+biz\s*=\s*\"\"\s*\|\|\s*\"([^\"]+)\"/) ||
      h.match(/var\s+biz\s*=\s*\"([^\"]+)\"/) || [])[1];
    const mid = (h.match(/var\s+mid\s*=\s*\"\"\s*\|\|\s*\"([^\"]+)\"/) ||
      h.match(/var\s+mid\s*=\s*\"([^\"]+)\"/) || [])[1];
    const sn = (h.match(/var\s+sn\s*=\s*\"\"\s*\|\|\s*\"([^\"]+)\"/) ||
      h.match(/var\s+sn\s*=\s*\"([^\"]+)\"/) || [])[1];
    console.log({ biz, mid, sn, nick: nick.trim() });
    const tries = [
      og && og[1],
      canonical && canonical[1],
      biz && mid && sn && `https://mp.weixin.qq.com/s?__biz=${biz}&mid=${mid}&idx=1&sn=${sn}`,
      share
    ].filter(Boolean);
    for (const u of tries) {
      const res = await fetch(PLATFORM + '/api/v2/platform/wxs2mp', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          xid: String(auth.vid),
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({ url: u.split('#')[0] })
      });
      console.log('wxs', u.slice(0, 90), res.status, (await res.text()).slice(0, 180));
    }
    const mpId = 'MP_WXS_' + Buffer.from(biz, 'base64').toString('utf8').replace(/[^\d]/g, '');
    const ar = await fetch(
      PLATFORM + '/api/v2/platform/mps/' + encodeURIComponent(mpId) + '/articles?page=1',
      {
        headers: {
          xid: String(auth.vid),
          Authorization: 'Bearer ' + auth.token
        }
      }
    );
    const data = await ar.json();
    console.log('articles after init', mpId, Array.isArray(data) ? data.length : data);
    break;
  }
})();
