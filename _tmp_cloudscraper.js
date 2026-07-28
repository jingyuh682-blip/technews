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
  const parts = [...body.matchAll(/url\s*\+=\s*'([^']*)';/g)].map((m) => m[1]);
  if (parts.length) return parts.join('').replace(/@/g, '');
  const m = body.match(/https?:\/\/mp\.weixin\.qq\.com\/s[^"'\s]+/);
  return m ? m[0] : '';
}

(async () => {
  const name = '量子位';
  const searchUrl =
    'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(name) + '&ie=utf8';
  try {
    const html = await cloudscraper.get({
      uri: searchUrl,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    console.log('search len', html.length);
    const m = html.match(/href="(\/link\?url=[^"]+)"/);
    if (!m) {
      console.log('no link');
      return;
    }
    const link = addKH(m[1].replace(/&amp;/g, '&'));
    console.log('link', link.slice(0, 120));
    const body = await cloudscraper.get({
      uri: link,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: searchUrl
      },
      followAllRedirects: true
    });
    console.log('body head', String(body).slice(0, 250).replace(/\s+/g, ' '));
    const share = assemble(String(body));
    console.log('share', share.slice(0, 180));
    if (!share) return;
    const wxs = await fetch(PLATFORM + '/api/v2/platform/wxs2mp', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        xid: String(auth.vid),
        Authorization: 'Bearer ' + auth.token
      },
      body: JSON.stringify({ url: share.split('#')[0] })
    });
    console.log('wxs', wxs.status, (await wxs.text()).slice(0, 400));
    const biz = (share.match(/[?&]__biz=([^&]+)/) || [])[1];
    if (biz) {
      const id = bizToMpId(decodeURIComponent(biz));
      console.log('mpId', id);
      const ar = await fetch(
        PLATFORM + '/api/v2/platform/mps/' + encodeURIComponent(id) + '/articles?page=1',
        {
          headers: {
            xid: String(auth.vid),
            Authorization: 'Bearer ' + auth.token
          }
        }
      );
      const t = await ar.text();
      const data = JSON.parse(t);
      console.log('articles', data.length, data[0] && data[0].title);
    }
  } catch (e) {
    console.log('fail', e.message || e);
  }
})();
