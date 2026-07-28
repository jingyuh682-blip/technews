const cloudscraper = require("cloudscraper");

async function tryAPI(url) {
  try {
    const body = await cloudscraper.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.jiqizhixin.com/articles"
      }
    });
    const preview = body.slice(0, 300);
    const isJSON = body.trim().startsWith("{") || body.trim().startsWith("[");
    console.log((isJSON ? "JSON" : "HTML") + " | " + url + " | " + preview.slice(0, 120).replace(/\n/g, " "));
  } catch(e) {
    console.log("FAIL | " + url + " | " + String(e.message||e).slice(0, 80));
  }
}

async function main() {
  const endpoints = [
    "https://www.jiqizhixin.com/api/v1/articles",
    "https://www.jiqizhixin.com/api/articles",
    "https://www.jiqizhixin.com/graphql",
    "https://api.jiqizhixin.com/articles",
    "https://api.jiqizhixin.com/v2/articles",
    "https://www.jiqizhixin.com/api/v1/posts",
  ];
  
  for (const url of endpoints) {
    await tryAPI(url);
  }
}
main().catch(e => console.error(e));