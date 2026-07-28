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

async function wxs(url) {
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
  return { status: res.status, text: await res.text() };
}

(async () => {
  const name = '量子位';
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8';
  const html = await cloudscraper.get({ uri: searchUrl });
  const href = [...String(html).matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  )[5];
  const body = await cloudscraper.get({
    uri: addKH(href),
    headers: { Referer: searchUrl },
    followAllRedirects: true
  });
  const assembled = assemble(body);
  const variants = [
    assembled,
    assembled.replace(/\*/g, '/'),
    assembled.replace(/\*/g, '%2F'),
    decodeURIComponent(assembled.replace(/\*/g, '%2F'))
  ];
  for (const u of variants) {
    console.log('try', u.slice(0, 120));
    const r = await wxs(u.split('#')[0]);
    console.log(r.status, r.text.slice(0, 250));
  }

  // Also: open *-/fixed URL in browser sense and extract /s/SHORT from final page
  const fixed = assembled.replace(/\*/g, '/');
  try {
    const page = await cloudscraper.get({
      uri: fixed,
      followAllRedirects: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const h = String(page);
    fs.writeFileSync('/tmp/fixed_page.html', h.slice(0, 15000));
    const nick = (h.match(/id=\"js_name\"[^>]*>([\s\S]*?)</) || [])[1];
    const sn = (h.match(/var\s+sn\s*=\s*\"\"\s*\|\|\s*\"([^\"]+)\"/) ||
      h.match(/sn\s*=\s*\"([a-f0-9]{10,})\"/) || [])[1];
    const biz = (h.match(/var\s+biz\s*=\s*\"\"\s*\|\|\s*\"([^\"]+)\"/) ||
      h.match(/var\s+biz\s*=\s*\"([^\"]+)\"/) || [])[1];
    const mid = (h.match(/var\s+mid\s*=\s*\"\"\s*\|\|\s*\"([^\"]+)\"/) ||
      h.match(/var\s+mid\s*=\s*\"([^\"]+)\"/) || [])[1];
    const short = (h.match(/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]{10,})/) || [])[1];
    console.log({ nick, biz, mid, sn, short });
    if (biz && mid && sn) {
      const u = `https://mp.weixin.qq.com/s?__biz=${biz}&mid=${mid}&idx=1&sn=${sn}`;
      console.log('canon', await wxs(u));
    }
    if (short) console.log('short', await wxs('https://mp.weixin.qq.com/s/' + short));
  } catch (e) {
    console.log('fixed open fail', e.message);
  }
})();
