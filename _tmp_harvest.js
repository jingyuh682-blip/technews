const cloudscraper = require('cloudscraper');
const fs = require('fs');
const auth = JSON.parse(fs.readFileSync('/var/www/technews/data/wechat-auth.json', 'utf8'));
const PLATFORM = 'https://weread.111965.xyz';

function bizToMpId(biz) {
  const buf = Buffer.from(String(biz).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const digits = buf.toString('utf8').replace(/[^\d]/g, '');
  return digits ? 'MP_WXS_' + digits : '';
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
  return { n: Array.isArray(data) ? data.length : -1, title: data && data[0] && data[0].title };
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
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_e) {}
  return { status: res.status, data: Array.isArray(data) ? data[0] : null, text: text.slice(0, 200) };
}

(async () => {
  // 1) harvest short links from aiera and resolve all unique mps
  const html = await cloudscraper.get({ uri: 'https://www.aiera.com.cn/' });
  const shorts = [
    ...new Set(
      [...String(html).matchAll(/https?:\/\/mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]{6,}/g)].map(
        (m) => m[0]
      )
    )
  ];
  console.log('aiera shorts', shorts.length);
  const found = new Map();
  for (const u of shorts.slice(0, 25)) {
    const r = await wxs(u);
    if (r.data && r.data.id) {
      found.set(r.data.name, r.data.id);
      console.log('map', r.data.name, r.data.id);
    } else {
      console.log('fail', u.slice(-20), r.status, r.text);
    }
    await new Promise((x) => setTimeout(x, 400));
  }

  // 2) type=1 sogou with cloudscraper
  for (const name of ['量子位', '机器之心', 'CVer', 'Datawhale', '腾讯技术工程']) {
    const url =
      'https://weixin.sogou.com/weixin?type=1&query=' + encodeURIComponent(name) + '&ie=utf8';
    try {
      const page = await cloudscraper.get({ uri: url });
      fs.writeFileSync('/tmp/t1_' + name + '.html', String(page).slice(0, 30000));
      const bizs = [...String(page).matchAll(/[?&]__biz=([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
      const fake = [...String(page).matchAll(/fakeid=([A-Za-z0-9+/=]+)/g)].map((m) => m[1]);
      const wechatid = [...String(page).matchAll(/微信号[\s\S]{0,40}?([a-zA-Z0-9_]+)/g)].map(
        (m) => m[1]
      );
      console.log('t1', name, 'len', String(page).length, 'biz', bizs.slice(0, 3), 'fake', fake.slice(0, 3), 'wxid', wechatid.slice(0, 3));
      // dump interesting chunk
      const i = String(page).indexOf('txt-box');
      if (i >= 0) console.log('chunk', String(page).slice(i, i + 400).replace(/\s+/g, ' '));
    } catch (e) {
      console.log('t1 fail', name, e.message);
    }
  }

  // 3) verify known
  for (const [name, id] of found) {
    const ar = await articles(id);
    console.log('arts', name, id, ar);
  }
  console.log('known 量子位', await articles('MP_WXS_3236757533'));
  console.log('known 机器之心', await articles('MP_WXS_3073282833'));
})();
