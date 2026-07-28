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

(async () => {
  const name = '量子位';
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8';
  const html = await cloudscraper.get({ uri: searchUrl });
  const hrefs = [...new Set([...String(html).matchAll(/href="(\/link\?url=[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))];

  for (const href of hrefs.slice(0, 8)) {
    const body = await cloudscraper.get({
      uri: addKH(href),
      headers: { Referer: searchUrl },
      followAllRedirects: true
    });
    const text = String(body);
    fs.writeFileSync('/tmp/jump.html', text.slice(0, 8000));
    console.log('--- jump head', text.slice(0, 300).replace(/\s+/g, ' '));
    const parts = [...text.matchAll(/url\s*\+=\s*'([^']*)';/g)].map((m) => m[1]);
    const assembled = parts.join('').replace(/@/g, '');
    console.log('parts', parts.length, 'assembled', assembled.slice(0, 200));
    // Also try extracting from script location.replace
    const rep = text.match(/replace\((['"])(https?:\/\/[^'"]+)\1\)/);
    console.log('replace', rep && rep[2] && rep[2].slice(0, 160));

    if (assembled && assembled.includes('mp.weixin')) {
      // Prefer URLs with sn= or /s/shortid
      const res = await fetch(PLATFORM + '/api/v2/platform/wxs2mp', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          xid: String(auth.vid),
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({ url: assembled.split('#')[0] })
      });
      const t = await res.text();
      console.log('wxs assembled', res.status, t.slice(0, 220));
      if (res.status === 200) {
        const data = JSON.parse(t)[0];
        if (data && data.name === name) {
          const ar = await fetch(
            PLATFORM + '/api/v2/platform/mps/' + encodeURIComponent(data.id) + '/articles?page=1',
            {
              headers: {
                xid: String(auth.vid),
                Authorization: 'Bearer ' + auth.token
              }
            }
          );
          const arts = await ar.json();
          console.log('SUCCESS', data.id, arts.length, arts[0] && arts[0].title);
          return;
        }
      }
    }
  }
  console.log('no success');
})();
