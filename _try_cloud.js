
const cloudscraper = require('cloudscraper');
const cheerio = require('cheerio');

async function tryUrl(name, url) {
  try {
    const html = await cloudscraper.get({
      uri: url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      timeout: 25000
    });
    const text = String(html || '');
    console.log(name, 'len', text.length);
    console.log(' marks', JSON.stringify({
      comment: (text.match(/评论/g)||[]).length,
      rating: (text.match(/评价/g)||[]).length,
      pay: (text.match(/付款/g)||[]).length,
      sold: (text.match(/已售/g)||[]).length,
      glItem: (text.match(/gl-item/g)||[]).length,
      pName: (text.match(/p-name/g)||[]).length,
      risk: (text.match(/risk_handler|验证|异常流量/g)||[]).length
    }));
  } catch (e) {
    console.log(name, 'FAIL', e.message || String(e));
  }
}

(async () => {
  await tryUrl('jd', 'https://search.jd.com/Search?keyword=%E5%A4%A7%E6%A8%A1%E5%9E%8B&cat=1713&psort=3');
  await tryUrl('tb', 'https://s.taobao.com/search?q=%E5%A4%A7%E6%A8%A1%E5%9E%8B%E4%B9%A6&sort=sale-desc');
  await tryUrl('dd', 'http://bang.dangdang.com/books/bestsellers/01.54.00.00.00.00-recent7-0-0-1-1');
})();
