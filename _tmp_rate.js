const fs = require('fs');
const auth = JSON.parse(fs.readFileSync('/var/www/technews/data/wechat-auth.json', 'utf8'));
const PLATFORM = 'https://weread.111965.xyz';

async function articles(mpId) {
  const res = await fetch(
    PLATFORM + '/api/v2/platform/mps/' + encodeURIComponent(mpId) + '/articles?page=1',
    {
      headers: {
        xid: String(auth.vid),
        Authorization: 'Bearer ' + auth.token,
        Accept: 'application/json'
      }
    }
  );
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 180) };
}

(async () => {
  for (const id of [
    'MP_WXS_3271041950',
    'MP_WXS_3073282833',
    'MP_WXS_3236757533',
    'MP_WXS_3080584025'
  ]) {
    console.log(id, await articles(id));
    await new Promise((r) => setTimeout(r, 2000));
  }
  // try weread official with token variants
  const q = encodeURIComponent('量子位');
  for (const [url, headers] of [
    [
      `https://i.weread.qq.com/store/search?keyword=${q}&count=10&type=0`,
      { vid: String(auth.vid), accessToken: auth.token, 'User-Agent': 'WeRead/7.0.0' }
    ],
    [
      `https://i.weread.qq.com/book/search?keyword=${q}&count=10`,
      { vid: String(auth.vid), skey: auth.token, accessToken: auth.token }
    ],
    [
      `https://weread.qq.com/web/search/global?keyword=${q}`,
      {
        Cookie: `wr_vid=${auth.vid}; wr_skey=${auth.token};`,
        'User-Agent': 'Mozilla/5.0'
      }
    ]
  ]) {
    try {
      const res = await fetch(url, { headers });
      console.log(url.slice(0, 60), res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.log(url.slice(0, 60), e.message);
    }
  }
})();
