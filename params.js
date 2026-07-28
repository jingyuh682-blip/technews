const cloudscraper = require("cloudscraper");

async function test(url, label) {
  try {
    const body = await cloudscraper.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.jiqizhixin.com/articles"
      }
    });
    const data = JSON.parse(body);
    const isArr = Array.isArray(data);
    const count = isArr ? data.length : (data.data ? data.data.length : "?");
    console.log(label + " | items=" + count + " | keys=" + (isArr && data[0] ? Object.keys(data[0]).join(",") : "n/a"));
    if (isArr && data[0]) {
      console.log("  sample:", JSON.stringify(data[0]).slice(0, 300));
    }
  } catch(e) {
    console.log(label + " | FAIL: " + String(e.message||e).slice(0, 80));
  }
}

async function main() {
  await test("https://www.jiqizhixin.com/api/v1/articles", "default");
  await test("https://www.jiqizhixin.com/api/v1/articles?page=1&per_page=20", "page+per_page");
  await test("https://www.jiqizhixin.com/api/v1/articles?page=1&per=20", "page+per");
  await test("https://www.jiqizhixin.com/api/v1/articles?limit=20", "limit");
  await test("https://www.jiqizhixin.com/api/v1/articles?page_size=20", "page_size");
}
main().catch(e => console.error(e));