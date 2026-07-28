const cloudscraper = require("cloudscraper");

async function main() {
  const body = await cloudscraper.get("https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=5", {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://www.jiqizhixin.com/articles"
    }
  });
  
  console.log("Response length:", body.length);
  
  const data = JSON.parse(body);
  console.log("Keys:", Object.keys(data).join(", "));
  
  if (data.articles || data.data) {
    const items = data.articles || data.data;
    console.log("Items:", items.length);
    if (items[0]) {
      console.log("\nKeys:", Object.keys(items[0]).join(", "));
      console.log("\nFirst item:");
      console.log(JSON.stringify(items[0], null, 2));
    }
  } else {
    console.log("\nFull response:", JSON.stringify(data, null, 2).slice(0, 2000));
  }
}
main().catch(e => console.error(e));